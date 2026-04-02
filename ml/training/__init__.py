"""Training pipeline for fraud detection models."""


def run() -> None:
	from ml.training.pipeline import run as _run

	_run()


__all__ = ["run"]
