"""Train the U-Net building-segmentation model on tiles from prepare_data.py.

  python train.py --data tiles --out runs/r34 --epochs 50              # from ImageNet weights
  python train.py --data tiles_gvmc --out runs/r34_gvmc --init runs/r34/best.pt --epochs 20 --lr 1e-4
                                                                         # fine-tune on Visakhapatnam
Keeps the checkpoint with the best validation IoU at <out>/best.pt.
"""
import argparse
import json
import os
import time

import torch

from common import FootprintNet, TileDataset, load_checkpoint


def augmentations():
    import albumentations as A
    return A.Compose([
        A.HorizontalFlip(), A.VerticalFlip(), A.RandomRotate90(),
        A.Affine(scale=(0.8, 1.25), rotate=(-15, 15), p=0.5),           # scale: GSD varies per upload
        A.RandomBrightnessContrast(0.25, 0.25, p=0.7),
        A.HueSaturationValue(10, 20, 10, p=0.4),
        A.OneOf([A.GaussianBlur(), A.GaussNoise()], p=0.25),            # drone blur, sensor noise
    ])


def iou_counts(logits, y):
    pred = logits > 0
    y = y > 0.5
    return (pred & y).sum().item(), (pred | y).sum().item()


def main(a):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(a.seed)
    train_dl = torch.utils.data.DataLoader(TileDataset(a.data, "train", augmentations()), batch_size=a.batch,
                                           shuffle=True, num_workers=a.workers, drop_last=True, pin_memory=True)
    val_dl = torch.utils.data.DataLoader(TileDataset(a.data, "val"), batch_size=a.batch, num_workers=a.workers)
    if a.init:
        model, _ = load_checkpoint(a.init, device=device)
        model.train()
    else:
        model = FootprintNet(a.encoder)
    model.to(device)

    import segmentation_models_pytorch as smp
    bce, dice = torch.nn.BCEWithLogitsLoss(), smp.losses.DiceLoss(mode="binary", from_logits=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=a.epochs * len(train_dl))
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    os.makedirs(a.out, exist_ok=True)
    best, history = -1.0, []

    for epoch in range(1, a.epochs + 1):
        model.train()
        t0, loss_sum = time.time(), 0.0
        for x, y in train_dl:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device, enabled=device == "cuda"):
                logits = model(x)
                loss = bce(logits, y) + dice(logits, y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            loss_sum += loss.item()

        model.eval()
        inter = union = 0
        with torch.no_grad(), torch.autocast(device_type=device, enabled=device == "cuda"):
            for x, y in val_dl:
                i, u = iou_counts(model(x.to(device)), y.to(device))
                inter, union = inter + i, union + u
        val_iou = inter / max(union, 1)
        history.append({"epoch": epoch, "loss": round(loss_sum / len(train_dl), 4), "val_iou": round(val_iou, 4),
                        "seconds": round(time.time() - t0)})
        print(history[-1], flush=True)
        if val_iou > best:
            best = val_iou
            torch.save({"state_dict": model.state_dict(), "encoder": a.encoder, "epoch": epoch,
                        "val_iou": val_iou, "args": vars(a)}, os.path.join(a.out, "best.pt"))
    with open(os.path.join(a.out, "history.json"), "w") as f:
        json.dump({"best_val_iou": best, "history": history}, f, indent=2)
    print(f"best val IoU {best:.4f} -> {os.path.join(a.out, 'best.pt')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="tile root from prepare_data.py")
    ap.add_argument("--out", required=True)
    ap.add_argument("--encoder", default="resnet34")
    ap.add_argument("--init", help="checkpoint to fine-tune from")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--seed", type=int, default=0)
    main(ap.parse_args())
