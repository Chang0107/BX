from ultralytics import YOLO
import cv2
import os


def _side_of_line(point_x, line_x):
    return -1 if point_x < line_x else 1


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


def run_object_counting(
    source=0,
    model_path="yolov8n.pt",
    conf=0.35,
    tracker_name="bytetrack",
    count_once_per_id=True,
):
    """
    Count objects that cross a virtual vertical line.
    The line is drawn in the center of each frame.
    """
    model_path = _normalize_model_path(model_path)
    tracker_yaml, tracker_label = _normalize_tracker(tracker_name)
    model = YOLO(model_path)
    try:
        results = model.track(source=source, stream=True, persist=True, conf=conf, tracker=tracker_yaml)
    except ModuleNotFoundError as exc:
        if "lap" not in str(exc):
            raise
        print("Tracking dependency 'lap' is missing.")
        print("Please install: python -m pip install lap")
        raise SystemExit(1)

    count_in = 0
    count_out = 0
    track_memory = {}
    counted_in_ids = set()
    counted_out_ids = set()

    print(f"Counting source: {source}")
    print(f"Tracker: {tracker_label}")
    if count_once_per_id:
        print("Counting mode: one-time per ID per direction (anti-duplicate).")
    print("Press 'q' to stop.")

    for result in results:
        frame = result.orig_img.copy()
        height, width = frame.shape[:2]
        line_x = width // 2

        boxes = result.boxes
        if boxes is not None and boxes.id is not None:
            ids = boxes.id.int().cpu().tolist()
            xyxy_list = boxes.xyxy.cpu().tolist()

            for track_id, xyxy in zip(ids, xyxy_list):
                x1, y1, x2, y2 = map(int, xyxy)
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2

                prev_side = track_memory.get(track_id)
                curr_side = _side_of_line(cx, line_x)

                if prev_side is not None and prev_side != curr_side:
                    if prev_side == -1 and curr_side == 1:
                        if (not count_once_per_id) or (track_id not in counted_in_ids):
                            count_in += 1
                            counted_in_ids.add(track_id)
                    elif prev_side == 1 and curr_side == -1:
                        if (not count_once_per_id) or (track_id not in counted_out_ids):
                            count_out += 1
                            counted_out_ids.add(track_id)

                track_memory[track_id] = curr_side

                cv2.rectangle(frame, (x1, y1), (x2, y2), (60, 180, 75), 2)
                cv2.circle(frame, (cx, cy), 4, (0, 255, 255), -1)
                cv2.putText(
                    frame,
                    f"ID {track_id}",
                    (x1, max(20, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 255, 255),
                    2,
                )

        cv2.line(frame, (line_x, 0), (line_x, height), (0, 0, 255), 2)
        cv2.putText(frame, f"IN: {count_in}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 220, 0), 2)
        cv2.putText(frame, f"OUT: {count_out}", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 220, 220), 2)

        cv2.imshow("YOLO Object Counting", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cv2.destroyAllWindows()


if __name__ == "__main__":
    user_source = input("Enter source (0 for webcam, or image/video path) [Default: 0]: ") or "0"
    user_model = input("Model path [Default: yolov8n.pt]: ") or "yolov8n.pt"
    user_tracker = input("Tracker (bytetrack/botsort) [Default: bytetrack]: ") or "bytetrack"
    user_once = input("Count each ID only once per direction? (y/n) [Default: y]: ") or "y"

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

    run_object_counting(
        source=source_val,
        model_path=user_model,
        tracker_name=user_tracker,
        count_once_per_id=user_once.strip().lower() not in ("n", "no"),
    )
