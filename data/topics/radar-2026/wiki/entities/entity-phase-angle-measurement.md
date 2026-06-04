---
id: "entity-phase-angle-measurement"
title: "相位法测角"
type: entity
node_type: entity
entity_type: module
summary: 通过接收天线阵列间的相位差计算目标角度的测量方法
status: draft
confidence: 0.65
tags:
  - 雷达技术
  - 角度测量
  - 信号处理
source_ids:
  - src-20260601-2026目标角度测量
parent_ids:
  - concept-angle-measurement-principle
related_ids:
  - entity-amplitude-angle-measurement
  - concept-multi-valued-problem
created: 2026-06-01
updated: 2026-06-01
---

# 相位法测角

## 定义
相位法测角是通过接收天线阵列间电磁波相位差计算目标角度的测量方法，属于雷达系统角度测量技术中的核心模块。该方法基于电磁波传播特性，通过分析多天线接收信号的相位关系实现角度计算，是高精度测角的关键技术之一。

## 详细属性
| 参数 | 规格 | 工作条件 |
|------|------|----------|
| 天线间距 | d | 电磁环境稳定 |
| 波长 | λ | 信号频率固定 |
| 角度范围 | [-θ_max, θ_max] | 无遮挡环境 |
| 测角精度 | ±0.1° | 信号强度≥-30dB |
| 适用场景 | 远距离目标 | 多天线阵列 |

## 工作原理
相位法测角基于电磁波传播的相位差特性，当目标位于不同方向时，天线阵列接收的电磁波相位存在差异。通过公式φ=2π/λ·d sinθ计算相位差，其中φ为相位差，d为天线间距，λ为波长，θ为目标方向角。该方法通过多天线阵列接收信号，计算相位差来确定目标角度。

相位法存在多值性问题，即相位差与角度之间存在多对一映射关系。为解决此问题，采用三天线法进行解模糊：通过计算φ12和φ13的相位差，结合天线间距比（d13/d12=6），最终得到角度θ=arcsin[(φ13λ)/(2πd13)]。其中N=INT[φ12·d13/(φ12·d12)]用于消除多值性影响。

## 使用场景与优缺点
### 应用场景
- 高精度测角需求（如火控系统）
- 远距离目标跟踪（≥10km）
- 多目标分辨（通过相位差区分）

### 优点
- 测角精度高（达0.1°）
- 可判别误差方向
- 抗干扰能力强

### 缺点
- 存在多值性问题需解模糊
- 对天线布置要求高
- 信号稳定性要求严格

### 注意事项
- 需确保天线间距d≥λ/2
- 避免多径干扰影响相位测量
- 定期校准天线相位基准

## 原文证据
- **公式推导**：φ=2π/λ·d sinθ → θ=arcsin(φλ/(2πd))
- **多值性问题**：φ=2πN+ψ，需通过三天线法解模糊
- **三天线法公式**：θ=arcsin[(φ13λ)/(2πd13)]，其中N=INT[φ12·d13/(φ12·d12)]
- **相位差计算**：φ=2π/λ·d sinθ

## 关联知识
- [[entity-amplitude-angle-measurement]]（振幅法测角）
- [[concept-multi-valued-problem]]（多值性问题）
- [[entity-auto-angle-tracking]]（自动测角系统）
- [[concept-antenna-pattern]]（天线方向图）

来源：`2026目标角度测量.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
