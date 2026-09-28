"""Shared by train / export / evaluate: the network definition and the tile dataset.

The worker (worker/src/extract/footprints.py · model_probability) feeds the ONNX model a
1×3×512×512 float32 tile scaled to [0, 1] — nothing else. So ImageNet normalisation lives *inside*
FootprintNet, for training and export alike, and the two can never drift apart.
"""
import glob
import os

import numpy as np
import torch
from torch import nn

TILE = 512
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


class FootprintNet(nn.Module):
    """[0,1] RGB → building logits (1 channel). sigmoid=True for the exported model."""

    def __init__(self, encoder="resnet34", encoder_weights="imagenet", sigmoid=False):
        super().__init__()
        import segmentation_models_pytorch as smp
        self.net = smp.Unet(encoder_name=encoder, encoder_weights=encoder_weights, in_channels=3, classes=1)
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))
        self.sigmoid = sigmoid

    def forward(self, x):
        y = self.net((x - self.mean) / self.std)
        return torch.sigmoid(y) if self.sigmoid else y


class TileDataset(torch.utils.data.Dataset):
    """<root>/<split>/images/*.png + masks/*.png (0 / 255) from prepare_data.py."""

    def __init__(self, root, split, augment=None):
        self.images = sorted(glob.glob(os.path.join(root, split, "images", "*.png")))
        if not self.images:
            raise FileNotFoundError(f"no tiles in {os.path.join(root, split, 'images')} — run prepare_data.py")
        self.augment = augment

    def __len__(self):
        return len(self.images)

    def __getitem__(self, i):
        import cv2
        img = cv2.cvtColor(cv2.imread(self.images[i]), cv2.COLOR_BGR2RGB)
        mask = cv2.imread(self.images[i].replace(f"{os.sep}images{os.sep}", f"{os.sep}masks{os.sep}"),
                          cv2.IMREAD_GRAYSCALE)
        if self.augment:
            out = self.augment(image=img, mask=mask)
            img, mask = out["image"], out["mask"]
        x = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1))).float() / 255.0
        y = torch.from_numpy((mask > 127).astype(np.float32))[None]
        return x, y


def load_checkpoint(path, sigmoid=False, device="cpu"):
    ck = torch.load(path, map_location=device, weights_only=False)
    model = FootprintNet(ck.get("encoder", "resnet34"), encoder_weights=None, sigmoid=sigmoid)
    model.load_state_dict(ck["state_dict"])
    return model.eval(), ck
