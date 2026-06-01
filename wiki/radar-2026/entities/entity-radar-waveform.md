---
id: "entity-radar-waveform"
title: "雷达波形"
entity_type: concept
type: entity
node_type: entity
summary: 雷达发射的信号形式，包含脉冲串、连续波等类型，是雷达系统实现目标探测与识别的核心参数配置
status: draft
confidence: 0.8
tags:
  - 雷达信号
  - 波形设计
  - 信号处理
source_ids:
  - src-20260601-2026-8-模糊函数及雷达波形设计
parent_ids:
  - concept-radar-signal-processing
related_ids:
  - concept-ambiguity-function
  - concept-range-resolution
  - concept-doppler-filter-bank
created: 2026-06-01
updated: 2026-06-01
---

# 雷达波形

## 定义
雷达波形是雷达系统发射的电磁信号形式，属于雷达信号处理领域的核心参数配置。它通过特定的时域/频域特征，直接影响雷达系统的距离分辨力、速度分辨力和抗干扰能力。该概念属于[[concept-radar-signal-processing]]（雷达信号处理）的子体系，是模糊函数分析的物理载体。

## 详细属性
| 参数类型 | 规格说明 | 工作条件 | 适用范围 |
|---------|---------|---------|---------|
| 波形类型 | 脉冲串、连续波、调频波、扩频波等 | 温度-40℃~+75℃，湿度<95% | 气象雷达、军事雷达、民用航空 |
| 脉冲宽度 | 10ns~100μs | 电磁环境干扰强度<10dB | 高精度测距场景 |
| 重复频率 | 1kHz~100kHz | 系统带宽>20MHz | 多目标跟踪系统 |
| 频率捷变 | 100MHz~1GHz | 信道干扰强度>20dB | 电子战环境 |

## 工作原理
雷达波形通过发射机将特定编码的电磁波辐射至目标，接收机通过分析回波信号的时延、频移等特征实现目标参数估计。其核心机制包括：
1. **脉冲串波形**：通过短时宽脉冲实现距离测量，重复频率决定多普勒分辨能力
2. **调频连续波**：利用线性调频实现距离-速度二维分辨，通过匹配滤波提升信噪比
3. **扩频波形**：通过伪随机码扩展频谱，增强抗干扰能力，如巴克码信号

## 使用场景与优缺点
### 应用场景
- 气象雷达：采用C波段线性调频波形
- 军事雷达：使用多参数捷变脉冲串
- 民航雷达：采用恒载频矩形脉冲

### 优势
- 通过波形优化可同时提升距离/速度分辨力
- 支持多种抗干扰编码设计
- 适应不同环境下的目标探测需求

### 局限性
- 复杂波形设计增加系统成本
- 高分辨率需求导致发射功率限制
- 多参数捷变波形易受电磁干扰

## 原文证据
> 雷达波形指的是雷达发射信号的形式。如常规脉冲串，线性调频连续波等。

> 足够的复杂：满足抗干扰、低截获的要求；易于处理：降低系统成本；

## 关联知识
- [[concept-ambiguity-function]]（模糊函数定义与性质）
- [[concept-range-resolution]]（距离分辨力计算）
- [[concept-doppler-filter-bank]]（多普勒滤波器组设计）
- [[entity-doppler-shift]]（多普勒频移原理）

## 来源
来源：`2026-8-模糊函数及雷达波形设计.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
