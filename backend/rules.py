"""偏航对中判定与弦线位移换算规则。

弦线位移读数必须先按基距当量换算为偏航角，再参与合格判定：
    yaw = atan2(弦线位移 mm, 基距 mm)，单位度
"""

import math

THRESHOLD_DEG = 1.5

# 当量参数与录入值的允许范围（越界即退回，不进单、不入流水）
BASE_MIN_MM_EXCLUSIVE = 0.0
BASE_MAX_MM = 100_000.0
DISPLACEMENT_MAX_MM = 100_000.0
ANGLE_MAX_DEG = 90.0

# 位移换算角与直填误差两路答案的一致性容差（度）
DUAL_ROUTE_TOLERANCE_DEG = 0.01

DEFAULT_BASE_DISTANCE_MM = 1000.0


class ConversionError(ValueError):
    """换算非法或越界；detail 为面向技师的清楚退回话术。"""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def judge(yaw_err_deg: float) -> tuple[str, str]:
    """按偏航角判定合格与否：绝对值不超过 1.5 度为合格。"""
    if abs(yaw_err_deg) <= THRESHOLD_DEG:
        return "合格", f"偏航误差 {yaw_err_deg:.4f}° 在 ±{THRESHOLD_DEG}° 以内"
    return "偏航超差", f"偏航误差 {yaw_err_deg:.4f}° 超过 ±{THRESHOLD_DEG}°"


def validate_base_distance(base_distance_mm: float) -> float:
    if not math.isfinite(base_distance_mm):
        raise ConversionError("基距必须是有效数字")
    if not (BASE_MIN_MM_EXCLUSIVE < base_distance_mm <= BASE_MAX_MM):
        raise ConversionError(
            f"基距必须大于 {BASE_MIN_MM_EXCLUSIVE:g} mm 且不超过 "
            f"{BASE_MAX_MM:g} mm（当前收到 {base_distance_mm:g} mm）"
        )
    return base_distance_mm


def validate_displacement(displacement_mm: float) -> float:
    if not math.isfinite(displacement_mm):
        raise ConversionError("弦线位移必须是有效数字")
    if abs(displacement_mm) > DISPLACEMENT_MAX_MM:
        raise ConversionError(
            f"弦线位移超出允许范围（±{DISPLACEMENT_MAX_MM:g} mm，"
            f"当前收到 {displacement_mm:g} mm）"
        )
    return displacement_mm


def validate_yaw_angle(yaw_err_deg: float) -> float:
    if not math.isfinite(yaw_err_deg):
        raise ConversionError("偏航误差必须是有效数字")
    if abs(yaw_err_deg) > ANGLE_MAX_DEG:
        raise ConversionError(
            f"偏航误差超出允许范围（±{ANGLE_MAX_DEG:g}°，"
            f"当前收到 {yaw_err_deg:g}°）"
        )
    return yaw_err_deg


def displacement_to_yaw(displacement_mm: float, base_distance_mm: float) -> float:
    """弦线位移（mm）按基距当量（mm）换算为偏航角（度）。"""
    validate_displacement(displacement_mm)
    validate_base_distance(base_distance_mm)
    return math.degrees(math.atan2(displacement_mm, base_distance_mm))


def resolve_inputs(
    displacement_mm,
    yaw_err_deg,
    base_distance_mm,
) -> dict:
    """把技师两路录入归一为偏航角。

    - 只给位移：按当前基距当量换算；
    - 只给误差：直接参与判定；
    - 两路都给：分别求解，答案必须在容差内一致，否则退回。

    返回 {mode, displacement_mm, base_distance_mm, yaw_err_deg}。
    """
    has_disp = displacement_mm is not None
    has_yaw = yaw_err_deg is not None
    if not has_disp and not has_yaw:
        raise ConversionError("弦线位移和偏航误差至少填写一项")

    if base_distance_mm is None:
        raise ConversionError(
            "弦线位移基距当量尚未配置，请先在「弦线位移换算」专页维护基距"
        )

    angle_from_disp = None
    if has_disp:
        angle_from_disp = displacement_to_yaw(
            float(displacement_mm), float(base_distance_mm)
        )

    angle_direct = None
    if has_yaw:
        angle_direct = validate_yaw_angle(float(yaw_err_deg))

    if has_disp and has_yaw:
        diff = abs(angle_from_disp - angle_direct)
        if diff > DUAL_ROUTE_TOLERANCE_DEG:
            raise ConversionError(
                "两路答案不一致：位移换算 "
                f"{angle_from_disp:.4f}°，直填误差 {angle_direct:.4f}°，"
                f"相差 {diff:.4f}°（容差 ±{DUAL_ROUTE_TOLERANCE_DEG:g}°），"
                "请核对读数或基距当量"
            )

    if has_disp:
        return {
            "mode": "displacement",
            "displacement_mm": float(displacement_mm),
            "base_distance_mm": float(base_distance_mm),
            "yaw_err_deg": angle_from_disp,
        }
    return {
        "mode": "direct",
        "displacement_mm": None,
        "base_distance_mm": None,
        "yaw_err_deg": angle_direct,
    }
