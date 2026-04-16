from ultralytics import YOLO
import cv2
import os


def run_obb_detection(source=0, model_path="yolov8n-obb.pt", conf=0.3):
    """Run YOLO oriented bounding box (OBB) detection."""
    model = YOLO(model_path)
    results = model.predict(source=source, stream=True, conf=conf)

    print(f"OBB source: {source}")
    print("Press 'q' to stop.")

    for result in results:
        frame = result.plot()
        cv2.imshow("YOLO OBB Detection", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cv2.destroyAllWindows()


if __name__ == "__main__":
    user_source = input("Enter source (0 for webcam, or image/video path) [Default: 0]: ") or "0"
    user_model = input("Model path [Default: yolov8n-obb.pt]: ") or "yolov8n-obb.pt"

    try:
        source_val = int(user_source)
    except ValueError:
        source_val = user_source
        if not os.path.exists(source_val):
            print(f"Error: source not found -> {source_val}")
            raise SystemExit(1)

    if not os.path.exists(user_model):
        print(f"Model not found locally ({user_model}), Ultralytics will try downloading it.")

    run_obb_detection(source=source_val, model_path=user_model)
