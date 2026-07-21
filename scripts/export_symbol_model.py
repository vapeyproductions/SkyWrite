"""Export the trained 62-class symbol recognizer for Level 4."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch import nn


LABELS = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")


class SymbolCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, 5, padding=2), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(128, 192, 3, padding=1), nn.BatchNorm2d(192), nn.ReLU(), nn.AdaptiveAvgPool2d(1),
        )
        self.head = nn.Sequential(nn.Flatten(), nn.Dropout(0.25), nn.Linear(192, len(LABELS)))

    def forward(self, value):
        return self.head(self.features(value))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = SymbolCNN(); model.load_state_dict(checkpoint["model_state"]); model.eval()
    output = Path(args.output_dir); output.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model, torch.zeros(1, 3, 48, 48), output / "symbol_recognizer.onnx",
        input_names=["drawing"], output_names=["logits"], opset_version=17, dynamo=False,
    )
    metadata = {
        "labels": checkpoint.get("labels", LABELS),
        "imageSize": int(checkpoint.get("image_size", 48)),
        "matchThreshold": 0.42,
        "marginThreshold": 0.12,
        "minimumPoints": 16,
    }
    (output / "symbol_recognizer.json").write_text(json.dumps(metadata), encoding="utf-8")


if __name__ == "__main__":
    main()
