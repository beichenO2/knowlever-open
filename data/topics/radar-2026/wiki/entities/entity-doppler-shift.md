---
id: "entity-doppler-shift"
 title: 多普勒频移
 type: entity
 node_type: entity
 entity_type: variable
 summary: 雷达与目标相对运动产生的频率变化现象，是脉冲多普勒雷达实现动目标检测的核心物理量
 status: draft
 confidence: 0.85
 tags:
   - 雷达原理
   - 信号处理
   - 多普勒效应
   - 动目标检测
 source_ids:
   - src-20260601-2026-10-脉冲多普勒雷达
 parent_ids:
   - concept-pulse-doppler-radar
 related_ids:
   - entity-prf
   - concept-motion-target-detection
 created: 2026-06-01
 updated: 2026-06-01
---

# 多普勒频移

## 定义
多普勒频移是雷达与目标相对运动时，回波信号频率相对于发射频率的偏移现象。该现象属于物理学中的多普勒效应范畴，在雷达技术中是实现动目标检测的核心物理量。作为脉冲多普勒雷达系统的关键参数，它直接反映目标的速度信息，并与PRF（脉冲重复频率）参数共同决定雷达的性能表现。

## 详细属性
| 参数 | 规格 | 单位 | 影响因素 |
|------|------|------|----------|
| 公式 | $ f_d = \frac{2v_R}{\lambda} \cos \phi $ | Hz | 目标速度 $ v_R $, 雷达波长 $ \lambda $, 夹角 $ \phi $ |
| 频率范围 | -45kHz~+45kHz | Hz | PRF参数选择 |
| 分辨能力 | 10Hz级 | Hz | 滤波器带宽 |
| 信噪比 | ≥20dB | dB | 滤波器设计 |

## 工作原理
多普勒频移的产生源于雷达波与目标的相对运动。当目标向雷达靠近时，回波频率会高于发射频率；当目标远离时，回波频率会低于发射频率。这种频率变化量与目标速度呈线性关系，通过测量频移量可计算目标速度。在脉冲多普勒雷达中，该频移量被用于频域滤波处理，通过窄带滤波器组提取特定多普勒频率的目标信号。

在机载PD雷达下视场景中，多普勒频移计算公式为：
```
$ f_d = \frac{2v_R}{\lambda} \cos \phi $ 
```
其中 $ v_R $ 为载机速度，$ \lambda $ 为雷达波长，$ \phi $ 为天线波束与地面夹角。该公式揭示了多普勒频移与平台运动参数的直接关系，是杂波抑制和目标检测的基础。

## 使用场景与特性
### 应用场景
- 机载预警雷达：通过多普勒频移区分静止杂波与运动目标
- 导弹制导系统：利用速度信息实现精确跟踪
- 气象雷达：测量降水粒子的径向速度

### 优势
- 提供目标速度信息
- 与PRF参数协同实现杂波抑制
- 适用于强杂波环境

### 局限性
- 存在速度模糊现象（低PRF模式）
- 需要精确的PRF参数选择
- 对目标运动方向敏感

## 原文证据
1. "多普勒频移计算：$ f_d = \frac{2v_R}{\lambda} \cos \phi $"（资料第12页）
2. "主瓣杂波中心频率：$ f_{MB} = \frac{2v_R}{\lambda} \cos \phi_0 $"（资料第15页）
3. "目标回波多普勒频率：$ f_d = \frac{2(v_R \pm v_T)}{\lambda} \cos \phi $"（资料第22页）

## 关联知识
- [[concept-pulse-doppler-radar]]：PD雷达系统中多普勒频移的工程应用
- [[entity-prf]]：PRF参数对多普勒频移检测的影响
- [[concept-motion-target-detection]]：运动目标检测中的多普勒频移处理
- [[concept-doppler-filter-bank]]：多普勒滤波器组对频移信号的提取

## 来源
资料：`2026-10-脉冲多普勒雷达.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
