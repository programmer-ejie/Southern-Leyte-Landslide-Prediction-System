from pathlib import Path

import h5py
import numpy as np
import torch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SAMPLE_IMAGE = PROJECT_ROOT / "training_docs" / "dataset" / "TestData" / "img" / "image_1.h5"


def load_h5_image(image_path=DEFAULT_SAMPLE_IMAGE):
    image_path = Path(image_path)

    with h5py.File(image_path, "r") as h5_file:
        image = h5_file["img"][:]

    return image


def preprocess_image(image):
    image = np.asarray(image, dtype=np.float32)

    if image.shape != (128, 128, 14):
        raise ValueError(f"Expected image shape (128, 128, 14), got {image.shape}")

    image = np.transpose(image, (2, 0, 1))

    for channel_index in range(image.shape[0]):
        channel = image[channel_index]
        min_value = np.nanmin(channel)
        max_value = np.nanmax(channel)

        if max_value > min_value:
            image[channel_index] = (channel - min_value) / (max_value - min_value)
        else:
            image[channel_index] = 0

    image = np.nan_to_num(image, nan=0.0, posinf=1.0, neginf=0.0)
    return torch.from_numpy(image).unsqueeze(0).float()


def load_sample_tensor(image_path=DEFAULT_SAMPLE_IMAGE):
    return preprocess_image(load_h5_image(image_path))


def preprocess_image_array(image):
    return preprocess_image(image)


def normalized_image_to_tensor(image):
    image = np.asarray(image, dtype=np.float32)

    if image.shape != (128, 128, 14):
        raise ValueError(f"Expected image shape (128, 128, 14), got {image.shape}")

    image = np.nan_to_num(image, nan=0.0, posinf=1.0, neginf=0.0)
    image = np.clip(image, 0.0, 1.0)
    image = np.transpose(image, (2, 0, 1))
    return torch.from_numpy(image).unsqueeze(0).float()
