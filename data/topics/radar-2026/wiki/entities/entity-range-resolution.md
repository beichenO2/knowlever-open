---
id: "entity-range-resolution"
title: "距离分辨力"
type: entity
node_type: entity
entity_type: concept
summary: 雷达系统区分两个距离相近目标的能力指标，由信号带宽和模糊函数主瓣宽度决定
status: draft
confidence: 0.85
tags:
  - 雷达信号
  - 分辨力分析
  - 模糊函数
  - 波形设计
source_ids:
  - src-20260601-2026-8-模糊函数及雷达波形设计
parent_ids:
  - concept-ambiguity-function
related_ids:
  - concept-doppler-filter-bank
  - concept-range-resolution
created: 2026-06-01
updated: 2026-06-01
---

# 距离分辨力

## 定义
距离分辨力是雷达系统区分两个距离相近目标的能力指标，属于雷达信号处理领域。该概念隶属于[[concept-ambiguity-function]]（模糊函数）体系，反映信号在距离维度上的分辨能力。

## 详细属性
| 参数 | 规格 | 说明 |
|------|------|------|
| 分辨力公式 | $\Delta R = \frac{c}{2B}$ | $c$为光速，$B$为信号带宽 |
| 主瓣宽度 | $\Delta \tau = \frac{1}{B}$ | 与模糊函数主瓣宽度直接相关 |
| 最小可分辨距离 | $\Delta R_{min} = \frac{c}{2B_{eff}}$ | $B_{eff}$为有效带宽 |
| 信噪比要求 | $\text{SNR} > 10\log_{10}(\frac{\Delta R}{\lambda})$ | $\lambda$为波长 |

## 工作原理
距离分辨力通过信号的时域特性实现目标区分。当两个目标距离差$\Delta R$小于分辨力时，其回波信号在时域上会产生重叠。根据模糊函数理论，距离分辨力由信号带宽$B$决定：

$$
\Delta R = \frac{c}{2B}
$$

其中，带宽越宽，距离分辨力越高。对于线性调频信号，有效带宽$B_{eff}$与脉冲宽度$T$和调频斜率$\Delta f$满足：

$$
B_{eff} = \frac{\Delta f}{T}
$$

## 使用场景与优缺点
### 应用场景
- 目标密集区域的分辨需求
- 精密距离测量任务
- 多目标跟踪系统

### 优点
- 通过带宽扩展提升分辨能力
- 与速度分辨力可独立优化
- 支持高精度距离测量

### 缺点
- 宽带信号可能降低作用距离
- 需要更高发射功率支持
- 增加系统复杂度

### 注意事项
- 需平衡带宽与作用距离的矛盾
- 考虑信号能量分配优化
- 避免与速度分辨力参数冲突

## 原文证据
> "距离分辨力：雷达仅从距离上分辨出两个目标的能力，如 =；
> 足够的信号带宽：满足距离分辨力的要求；
> 距离模糊函数主瓣宽度决定分辨能力"

> "距离分辨力常数为 $A_\tau = \frac{\int |\chi(\tau)|^2 d\tau}{\chi^2(0)}$"

## 关联知识
- [[concept-ambiguity-function]]（模糊函数定义与性质）
- [[concept-doppler-filter-bank]]（多普勒滤波器组设计）
- [[entity-doppler-shift]]（多普勒频移原理）
- [[synthesis-雷达信号处理总览]]（信号处理系统架构）

来源：`2026-8-模糊函数及雷达波形设计.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
