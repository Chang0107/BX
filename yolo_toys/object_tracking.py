from ultralytics import YOLO
import cv2
import os


def _normalize_model_path(model_path):
    if model_path.endswith(".py"):
        fixed = model_path[:-3] + ".pt"
        print(f"Model path looks wrong: {model_path} -> auto-fix to {fixed}")
        return fixed
    return model_path


def _normalize_tracker(tracker_name):
    name = (tracker_name or "bytetrack").strip().lower()
    if name in ("bytetrack", "bytetrack.yaml"):
        return "bytetrack.yaml", "ByteTrack"
    if name in ("botsort", "botsort.yaml"):
        return "botsort.yaml", "BoT-SORT"
    print(f"Unknown tracker '{tracker_name}', fallback to ByteTrack.")
    return "bytetrack.yaml", "ByteTrack"


def run_object_tracking(source=0, model_path="yolov8n.pt", conf=0.4, tracker_name="bytetrack"):
    """Run YOLO object tracking on webcam/video/image."""
    model_path = _normalize_model_path(model_path)
    tracker_yaml, tracker_label = _normalize_tracker(tracker_name)
    model = YOLO(model_path)

    try:
        results = model.track(
            source=source,
            stream=True,
            persist=True,
            conf=conf,
            tracker=tracker_yaml,
        )
        use_tracking = True
    except ModuleNotFoundError as exc:
        if "lap" not in str(exc):
            raise
        print("Tracking dependency 'lap' is missing. Falling back to plain detection mode.")
        print("Install command: python -m pip install lap")
        results = model.predict(source=source, stream=True, conf=conf)
        use_tracking = False

    print(f"Tracking source: {source}")
    print(f"Tracker: {tracker_label}")
    if not use_tracking:
        print("Now running DETECTION fallback (without track IDs).")
    print("Press 'q' to stop.")

    for result in results:
        frame = result.plot()
        cv2.imshow("YOLO Object Tracking", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cv2.destroyAllWindows()


if __name__ == "__main__":
    user_source = input("Enter source (0 for webcam, or image/video path) [Default: 0]: ") or "0"
    user_model = input("Model path [Default: yolov8n.pt]: ") or "yolov8n.pt"
    user_tracker = input("Tracker (bytetrack/botsort) [Default: bytetrack]: ") or "bytetrack"

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

    run_object_tracking(source=source_val, model_path=user_model, tracker_name=user_tracker)
