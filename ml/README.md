# Models

PS 26013 asks for AI-generated feature extraction, ML-based spatial matching, intelligent attribute mapping and confidence scoring. The models behind them:

| Model name | Type | Use case | PS 26013 requirement it solves | Where it is trained |
|---|---|---|---|---|
| **NAKSHA-Footprint-UNet** (U-Net, ResNet-34 encoder) | Deep learning: semantic segmentation (GeoAI / computer vision) | Draws building outlines automatically from drone imagery and ORI, replacing manual digitising | *AI-generated feature extraction*; GeoAI and computer vision | Kaggle / Colab **GPU**: `notebooks/02_footprint_unet_gpu.ipynb` |
| **NAKSHA-Matcher** (HistGradientBoosting + isotonic calibration) | Machine learning: calibrated binary classifier | Decides whether two records from different departments describe the same land parcel: cadastre ↔ property-tax GIS ↔ revenue ↔ buildings ↔ field GPS. Gives a calibrated 0–100 confidence | *AI/ML-based spatial matching*, *confidence scoring*; feeds *spatial conflict resolution* | Kaggle / Colab (CPU is enough): `notebooks/01_wards_and_matcher.ipynb`, on all 98 GVMC wards |
| gpt-oss-120b via Groq (hosted, not trained here) | Large language model | Suggests which columns match across departments (`khata_no` ↔ `KHATHA_NUM`); writes explanations, briefs and alerts | *Intelligent attribute mapping*; decision support | n/a |

## Training on Kaggle or Colab
Both notebooks clone this repository, install their own dependencies and zip their outputs for download. Nothing is deployed.

| Notebook | Runtime | What it does | Outputs |
|---|---|---|---|
| `notebooks/01_wards_and_matcher.ipynb` | CPU, Internet on | Downloads open data → generates the **98 GVMC ward zones** → builds each ward's land-record layers with an answer key → trains NAKSHA-Matcher, tested on held-out wards | `match_model.joblib`, `match_model.meta.json`, `wards.geojson`, `gvmc_buildings.geojson` |
| `notebooks/02_footprint_unet_gpu.ipynb` | **GPU** (Kaggle T4/P100, Colab T4) | Pre-trains on Inria aerial images → optional fine-tune on GVMC ORI with the 98-ward building labels → ONNX export → evaluation against the classical baseline | `footprint_unet_r34.onnx`, `eval.json`, `history.json` |

**How to run.**
- **Kaggle:** *New Notebook → File → Import Notebook*, then upload the `.ipynb`. Under *Settings*, turn Internet on and pick the accelerator (GPU for 02). *Save Version → Save & Run All*. Download the zip from the *Output* tab.
- **Colab:** *File → Upload notebook*. For 02, choose *Runtime → Change runtime type → T4 GPU*. Then *Runtime → Run all*; the zip downloads at the end.
- Set `BRANCH` in the first cell to the branch that holds this code. Notebook 02 has `QUICK = True` for a few-minute smoke test on generated imagery; set it to `False` for real training.

## Using the models in the app (optional)
Both models are optional at runtime; without a model file, the worker uses its rule-based methods.
- Put the files in `models/`: it is git-ignored and mounted into the worker at `/models`.
- `MATCH_MODEL_PATH=/models/match_model.joblib` enables ML matching.
- `FOOTPRINT_MODEL_PATH=/models/footprint_unet_r34.onnx` enables deep-learning extraction.

---

## 1. Spatial matcher (ML)

**What it learns.** Every candidate pair that `match_ward.sql` finds (IoU ≥ 0.30 or ≤ 25 m) gets 25 features, from `worker/src/harmonize/features.py`:
- geometry: IoU, distance, area ratio, Hausdorff distance, shape compactness
- attributes: overall agreement, plus owner / survey no. / khata similarity across each department's field names
- context: source reliability, recency and source types

The model outputs a calibrated **P(same land record)**. That probability becomes the match score (0–100) and drives:
- one-to-one selection
- the auto-accept / review / conflict bands
- conflict severity

Pairs below `MATCH_ML_THRESHOLD` (0.5) are dropped.

**Training data.**
1. *All 98 wards of the open-data pack* (`harmonize/pack_pairs.py`). These use real OSM streets and real building footprints. The generated cadastre, property-tax, revenue and field-GPS records carry the errors real departments make, and `answers.json → match_truth` says which parcel every record belongs to. This is the main source, built by notebook 01.
2. *Synthetic blocks* (`harmonize/synth_pairs.py`): small generated blocks with the same kinds of errors, including neighbouring plots with the same family owner. These are extra variety.
3. *Officer labels:* the **Same record / Not a match** buttons on the Matching page write to `match_labels` (migration `0020`), together with a snapshot of the features the model saw. Officer labels are weighted ×3.

```bash
# all 98 wards (after `python -m naksha_data build`), no database needed:
python worker/src/train_matcher.py --pack data/out --no-db --out models/match_model.joblib
# later: retrain on synthetic + officer labels; the new model replaces the old one only if its F1 is not lower
curl -X POST "$API/api/harmonization/retrain" -H "Authorization: Bearer $ADMIN_TOKEN"   # RETRAIN_MATCHER job
# then re-run matching for a ward (or all) to re-score:
curl -X POST "$API/api/harmonization/run?wardId=12" -H "Authorization: Bearer $TOKEN"
```

`RETRAIN_MATCHER` skips itself until 200 new officer labels have arrived (`force=true` overrides). Metrics are written next to the model in `match_model.meta.json`.

**How to read the scores.** The test set is 20% of the wards, never random rows, so the numbers are for wards the model has not seen. Even so, the pack's records are generated: the scores show that the method works, not how accurate it is on real GVMC records. That number comes from officer labels on real wards; report it once a few hundred exist.

---

## 2. Building-footprint segmentation (deep learning)

The worker already runs any ONNX model with this contract (`extract/footprints.py · model_probability`):

| | Tensor |
|---|---|
| input `image` | float32 **1×3×512×512**, RGB scaled to **[0, 1]** |
| output `prob` | float32 **1×1×512×512**, building probability |

ImageNet normalisation is built into the network (`ml/footprint/common.py · FootprintNet`). `export_onnx.py` checks the contract and checks that the ONNX output matches PyTorch.

### Data
| Stage | Imagery | Labels |
|---|---|---|
| Pre-train | [Inria Aerial Image Labeling](https://project.inria.fr/aerialimagelabeling/) (0.3 m, 5 cities), optionally SpaceNet | Masks provided (`--mask`) |
| Fine-tune (GVMC) | Visakhapatnam drone ORI (NAKSHA survey deliverable) | NAKSHA `building_footprint` layer, [Google Open Buildings v3](https://sites.research.google/open-buildings/) or Microsoft Building Footprints clipped to GVMC (`--labels`) |

Aim for a few thousand GVMC tiles across different neighbourhoods: dense old town, planned layouts, slums, industrial areas. Hand-check a sample: open-building labels miss some new structures and drift by 1–3 m on high-resolution ORI.

### Steps
Notebook `02_footprint_unet_gpu.ipynb` runs all of this on Kaggle/Colab. The equivalent commands:
```bash
pip install -r ml/footprint/requirements.txt
cd ml/footprint
# 1. tiles (splits are by spatial block, not random tiles)
python prepare_data.py --image inria/images/*.tif --mask inria/gt/*.tif --out tiles_inria --gsd 0.3 0.5
python prepare_data.py --image ori/ward*.tif --labels gvmc_buildings.geojson --out tiles_gvmc --gsd 0.3 0.5
# 2. pre-train (~2–3 h on a T4), then fine-tune on GVMC
python train.py --data tiles_inria --out runs/r34 --epochs 50
python train.py --data tiles_gvmc  --out runs/r34_gvmc --init runs/r34/best.pt --epochs 20 --lr 1e-4
# 3. export + verify the worker contract
python export_onnx.py --ckpt runs/r34_gvmc/best.pt --out ../../models/footprint_unet_r34.onnx
# 4. score against the worker's classical fallback on held-out GVMC tiles
python evaluate.py --onnx ../../models/footprint_unet_r34.onnx --data tiles_gvmc --split test --report eval.json
```
**Targets:** pixel IoU ≥ 0.70 and building-level F1 ≥ 0.75 (IoU ≥ 0.5 per building), clearly above the `classical` baseline that `evaluate.py` prints next to it.

**Imagery limit:** no open imagery of GVMC exists at drone resolution; satellite imagery is 10 m. The GVMC fine-tune therefore needs the department's ORI. Without it, the model is Inria-trained only.

**Resolution note:** the worker analyses a raster at no more than 4096 px on its longest side. A large ORI is therefore seen at a coarser ground sample distance than it was captured at. For that reason the tiles are cut at several resolutions (`--gsd 0.3 0.5`) and training uses scale augmentation. Upload ORI per ward or per sheet, not as one city mosaic.
