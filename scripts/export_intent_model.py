"""Export the trained DRAW/MOVE GRU and normalization data for the browser."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch import nn


FEATURE_COUNT = 70
WINDOW_SIZE = 30


class PenIntentGRU(nn.Module):
    def __init__(self):
        super().__init__()
        self.gru = nn.GRU(FEATURE_COUNT, 96, num_layers=2, batch_first=True, dropout=0.2)
        self.head = nn.Sequential(nn.LayerNorm(96), nn.Linear(96, 1))

    def forward(self, sequence):
        encoded, _ = self.gru(sequence)
        return self.head(encoded[:, -1]).squeeze(-1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = PenIntentGRU()
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        torch.zeros(1, WINDOW_SIZE, FEATURE_COUNT),
        output / "pen_intent.onnx",
        input_names=["features"],
        output_names=["logit"],
        opset_version=17,
        dynamo=False,
    )
    metadata = {
        "featureCount": int(checkpoint["feature_count"]),
        "windowSize": int(checkpoint["window_size"]),
        "featureMean": checkpoint["feature_mean"].tolist(),
        "featureStd": checkpoint["feature_std"].tolist(),
        "startThreshold": 0.70,
        "stopThreshold": 0.35,
        "startFrames": 3,
        "stopFrames": 4,
        "displayDelayMs": 250,
    }
    (output / "pen_intent.json").write_text(json.dumps(metadata), encoding="utf-8")


if __name__ == "__main__":
    main()
