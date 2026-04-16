from ultralytics import YOLO
import cv2
import os


def _normalize_model_path(model_path):
    if model_path.endswith(".py"):
        fixed = model_path[:-3] + ".pt"
        print(f"Model path looks wrong: {model_path} -> auto-fix to {fixed}")
        return fixed
    return model_path


def run_image_classification(source=0, model_path="yolov8n-cls.pt"):
    """Run YOLO image classification and display top-1 class."""
    model_path = _normalize_model_path(model_path)
    model = YOLO(model_path)
    results = model.predict(source=source, stream=True)

    print(f"Classification source: {source}")
    print("Press 'q' to stop.")

    try:
        for result in results:
            frame = result.orig_img.copy()
            probs = result.probs

            if probs is not None:
                top1_idx = int(probs.top1)
                top1_name = result.names.get(top1_idx, str(top1_idx))
                top1_score = float(probs.top1conf)
                label = f"{top1_name}: {top1_score:.2f}"
            else:
                label = "No classification result"

            cv2.putText(frame, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
            cv2.imshow("YOLO Image Classification", frame)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    except ConnectionError as exc:
        if isinstance(source, int):
            print(f"Cannot open webcam index {source}.")
            print("Try source=1 or provide an image/video path instead.")
            print(f"Details: {exc}")
            raise SystemExit(1)
        raise

    cv2.destroyAllWindows()


if __name__ == "__main__":
    user_source = input("Enter source (0 for webcam, or image/video path) [Default: 0]: ") or "0"
    user_model = input("Model path [Default: yolov8n-cls.pt]: ") or "yolov8n-cls.pt"

    try:
        source_val = int(user_source)
    except ValueError:
        source_val = user_source
        if not os.path.exists(source_val):
            print(f"Error: source not found -> {source_val}")
            raise SystemExit(1)

    user_model = _normalize_model_path(user_model)

    if not os.path.exists(user_model):
        print(f"Model not found locally ({user_model}), Ultralytics will try downloading it.")

    run_image_classification(source=source_val, model_path=user_model)
