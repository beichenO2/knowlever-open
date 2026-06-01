---
id: "entity-baseband-signal"
 title: 基带信号
 type: entity
 node_type: entity
 entity_type: signal
 summary: 通过正交解调得到的低频复信号，包含目标回波的幅度和相位信息
 status: draft
 confidence: 0.8
 tags:
   - 雷达信号处理
   - 基带处理
   - 正交解调
   - 信号检测
 source_ids:
   - src-20260601-2026-9-雷达信号处理
 parent_ids:
   - concept-radar-signal-processing
 related_ids:
   - entity-rf-signal
   - concept-baseband-signal-processing
   - concept-quadrature-demodulation
 created: 2026-06-01
 updated: 2026-06-01
---

# 基带信号

## 定义
基带信号是通过正交解调从射频信号中提取的低频复信号，包含目标回波的幅度和相位信息。它属于雷达信号处理领域的核心概念，是实现目标检测与参数估计的基础信号形式，位于雷达信号处理流程的基带处理阶段。

## 详细属性
| 参数 | 规格 | 说明 |
|------|------|------|
| 信号类型 | 复信号 | 包含I路和Q路双通道信号 |
| 频率范围 | 0-100MHz | 与射频载波频率无关 |
| 采样率 | ≥1/Δt | Δt为距离单元宽度（如1μs） |
| 信号特性 | 带通信号 | 需要复数采样处理 |
| 信息内容 | 幅度/相位 | 反映目标回波特征 |

工作条件：需配合正交解调器和高速ADC实现；适用范围：雷达、通信系统中的信号处理。

## 工作原理
基带信号通过正交解调实现：
1. 射频信号 x(t) = a(t)cos[2πf0t + φ(t)] 经过希尔伯特变换得到解析信号 Z(t) = X(f) + sign(f)·X(f)
2. 通过正交解调分离为I路（实部）和Q路（虚部）：
   - I(t) = a(t)cosφ(t)
   - Q(t) = a(t)sinφ(t)
3. 最终得到复包络信号 r(t) = I(t) + jQ(t) = a(t)e^{jφ(t)}

该过程保留了射频信号的全部信息，使后续数字处理成为可能。

## 使用场景与优缺点
### 使用场景
- 目标检测：通过幅度分析识别目标存在
- 参数估计：利用相位信息计算目标速度
- 信号处理：为MTI/MTD等算法提供输入数据

### 优点
- 采样率要求低于射频信号
- 便于数字信号处理
- 保留完整目标信息

### 注意事项
- 需保持相位信息完整性
- 需要抗混叠滤波处理
- 采样率需满足奈奎斯特准则

## 原文证据
> "射频信号均为带通实信号，不便数字采样...将射频信号变到基带信号再处理"（资料原文）

> "正交解调后的复包络信号 r(t) = a(t)e^{jφ(t)}"（资料原文）

> "基带信号无信息丢失"（资料原文）

## 关联知识
- [[entity-rf-signal]] 射频信号的时域表达式及频谱特性
- [[concept-baseband-signal-processing]] 基带信号处理流程
- [[concept-quadrature-demodulation]] 正交解调原理
- [[concept-doppler-spectrum-analysis]] 多普勒频谱分析技术
- [[entity-cfar-processing]] 恒虚警处理算法原理

来源：`src-20260601-2026-9-雷达信号处理`

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
