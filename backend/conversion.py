"""弦线位移 → 偏航角换算。

技师在弦线上读到的是位移（毫米），判定一律以偏航角（度）为准。
偏航角由位移相对弦线基准半径（当量臂长 L，毫米）的反正切得到：

    yaw_err_deg = atan(s / L) * 180 / π

L 由顶栏「弦线位移换算偏航角」专页维护；换算流水记录每次换算，
与入队记录在同一事务落库。
"""

import math

# 位移合法量程（毫米），超出视为越界，不参与换算与判定。
DISP_MIN_MM = -1000.0
DISP_MAX_MM = 1000.0

# 当量臂长合法范围（毫米）。
ARM_MIN_MM = 1.0
ARM_MAX_MM = 100000.0

# 直填偏航误差合法范围（度）。
ERR_MIN_DEG = -90.0
ERR_MAX_DEG = 90.0

# 入参解析与越界时的统一话术。
ERR_NOT_NUMBER = "输入必须是数字"
ERR_DISP_RANGE = (
    f"弦线位移超出合法量程（{DISP_MIN_MM:g}~{DISP_MAX_MM:g} mm），"
    "请确认读数后重新提交"
)
ERR_ERR_RANGE = (
    f"偏航误差超出合法范围（{ERR_MIN_DEG:g}~{ERR_MAX_DEG:g}°），"
    "请确认读数后重新提交"
)
ERR_DISP_EMPTY = "请填写弦线位移读数（毫米）"
ERR_TWO_ROUTE = "位移换算结果与直填误差不一致，请核对读数或当量臂长"


def parse_number(value, *, allow_empty=False, empty_msg=ERR_NOT_NUMBER):
    """把前端入参解析成 float；空值/非数字抛 ConversionError。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        if allow_empty:
            return None
        raise ConversionError(empty_msg)
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ConversionError(ERR_NOT_NUMBER)


def validate_arm(arm_mm: float) -> float:
    if not math.isfinite(arm_mm) or not (ARM_MIN_MM <= arm_mm <= ARM_MAX_MM):
        raise ConversionError(
            f"当量臂长需在 {ARM_MIN_MM:g}~{ARM_MAX_MM:g} mm 之间"
        )
    return arm_mm


def displacement_to_yaw(displacement_mm: float, arm_mm: float) -> float:
    """位移（毫米）经反正切换算为偏航角（度）。"""
    if not math.isfinite(displacement_mm):
        raise ConversionError(ERR_NOT_NUMBER)
    validate_arm(arm_mm)
    if not (DISP_MIN_MM <= displacement_mm <= DISP_MAX_MM):
        raise ConversionError(ERR_DISP_RANGE)
    return math.degrees(math.atan(displacement_mm / arm_mm))


def validate_yaw(yaw_err_deg: float) -> float:
    if not math.isfinite(yaw_err_deg) or not (
        ERR_MIN_DEG <= yaw_err_deg <= ERR_MAX_DEG
    ):
        raise ConversionError(ERR_ERR_RANGE)
    return yaw_err_deg


class ConversionError(ValueError):
    """换算非法或越界，detail 即退回给技师的话术。"""
