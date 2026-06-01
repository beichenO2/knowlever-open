---
id: "entity-prf"
 title: PRF参数详解
 type: entity
 node_type: entity
 entity_type: config
 summary: 脉冲重复频率（PRF）是雷达系统中决定距离和速度分辨率的关键参数，直接影响杂波抑制效果和无杂波区分布
 status: draft
 confidence: 0.8
 tags:
   - 雷达参数
   - 信号处理
   - 杂波抑制
   - 脉冲多普勒
 source_ids:
   - src-20260601-2026-10-脉冲多普勒雷达
 parent_ids:
   - concept-pulse-doppler-radar
 related_ids:
   - concept-no-clutter-zone
   - concept-doppler-filter-bank
 created: 2026-06-01
 updated: 2026-06-01
---

# PRF参数详解

## 定义
PRF（Pulse Repetition Frequency，脉冲重复频率）是雷达系统中脉冲发射的周期性参数，单位为Hz。作为雷达系统的核心配置参数，PRF直接影响距离分辨率、速度分辨率和杂波抑制效果，在脉冲多普勒雷达中具有决定性作用（[[concept-pulse-doppler-radar]]）。

## 详细属性
| 参数类型 | 低PRF | 中PRF | 高PRF |
|---------|------|------|------|
| 频率范围 | <45kHz | 45-200kHz | >200kHz |
| 距离模糊 | 存在 | 存在 | 不存在 |
| 速度模糊 | 不存在 | 不存在 | 存在 |
| 杂波重叠 | 严重 | 中等 | 轻微 |
| 无杂波区 | 不存在 | 存在 | 存在 |
| 适用场景 | 近距离探测 | 中距离探测 | 远距离探测 |

## 工作原理
PRF通过控制脉冲发射周期影响雷达的两个核心性能：
1. **距离分辨率**：PRF越高，脉冲重复周期越短，距离模糊效应越弱，但会降低距离分辨率（公式：ΔR = c/(2fr)）
2. **速度分辨率**：PRF越低，多普勒频移测量精度越高，但容易产生速度模糊（公式：Δv = λ/(2T_r)）

在脉冲多普勒雷达中，PRF选择直接决定杂波分布特性：
- 当fr > fc_max时，形成无杂波区（[[concept-no-clutter-zone]]），目标信号可清晰检测
- 当fr < fc_max时，杂波与目标信号重叠，需要依赖多普勒滤波器组（[[concept-doppler-filter-bank]]）分离

## 使用场景与优缺点
### 适用场景
- **高PRF**：适用于远距离探测（如空警2000预警雷达）
- **中PRF**：适用于中距离目标跟踪（如导弹制导系统）
- **低PRF**：适用于近距离高速目标检测（如导弹告警系统）

### 优点
- 通过PRF选择可优化杂波抑制效果
- 支持距离-速度双分辨率需求
- 与多普勒滤波器组协同实现目标检测

### 缺点
- 高PRF导致距离模糊，需配合距离门选通
- 低PRF产生速度模糊，需依赖多普勒滤波
- 不同PRF模式需平衡分辨率与杂波抑制需求

## 原文证据
1. "PRF对杂波的影响：① 当低PRF，fr=2kHz时...② 当高PRF，fr=200kHz时...③ 当中PRF，fr=20kHz时..."（[[src-20260601-2026-10-脉冲多普勒雷达]]）
2. "无杂波区的形成条件：PRF > fc_max（主瓣杂波最大展宽频率）"（[[src-20260601-2026-10-脉冲多普勒雷达]]）
3. "PRF选择直接影响杂波重叠与无杂波区分布，决定检测性能"（[[src-20260601-2026-10-脉冲多普勒雷达]]）

## 关联知识
- [[entity-pulse-doppler-radar]]：PRF是PD雷达系统的核心配置参数
- [[concept-no-clutter-zone]]：PRF选择决定无杂波区是否存在
- [[concept-doppler-filter-bank]]：多普勒滤波器组与PRF模式的协同作用
- [[concept-motion-target-detection]]：PRF对运动目标检测性能的影响

## 来源
来源：`2026-10-脉冲多普勒雷达.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
