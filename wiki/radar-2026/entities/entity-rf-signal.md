---
id: "entity-rf-signal"
 title: 射频信号
 type: entity
 node_type: entity
 entity_type: signal
 summary: 高频载波信号，包含幅度调制和相位调制信息，是雷达、通信导航系统的核心传输载体
 status: draft
 confidence: 0.6
 tags:
   - 信号处理
   - 雷达技术
   - 通信工程
 source_ids:
   - src-20260601-2026-9-雷达信号处理
 parent_ids:
   - concept-radar-signal-processing
 related_ids:
   - concept-baseband-signal-processing
   - concept-doppler-spectrum-analysis
 created: 2026-06-01
 updated: 2026-06-01
---

# 射频信号

## 定义
射频信号是频率在3kHz以上（通常指100kHz以上）的电磁波信号，属于高频载波信号范畴。在雷达系统中，射频信号通过幅度调制（AM）和相位调制（PM）承载目标信息，是雷达、通信导航等系统的核心传输载体，属于[[concept-radar-signal-processing]]概念体系中的基础信号类型。

## 详细属性
| 参数 | 规格 | 说明 |
|------|------|------|
| 频率范围 | 220MHz～35GHz | 常用雷达工作频段 |
| 车载毫米波雷达 | 24GHz/60GHz/77GHz/79GHz | 主要频段分布 |
| GSM频段 | 900MHz | 移动通信标准 |
| 4G LTE频段 | 1.9GHz | 移动通信标准 |
| 5G频段 | 3.5GHz | 新一代通信标准 |
| 时域表达式 | x(t) = a(t)cos[2πf0t + φ(t)] | 标准射频信号形式 |
| 频谱特性 | 带通实信号 | 具有对称频谱分布 |

## 工作原理
射频信号通过调制技术将目标信息加载到高频载波上，其核心特征是：
1. **带通特性**：信号能量集中在载频f0附近，具有对称的频谱分布
2. **调制方式**：采用幅度调制（AM）和相位调制（PM）承载目标信息
3. **解调过程**：通过正交解调（IQ解调）将射频信号转换为复基带信号，提取幅度和相位信息
4. **采样要求**：需满足奈奎斯特采样定理，采样频率至少为信号带宽的两倍

## 使用场景与特性
### 应用场景
- 雷达系统：用于目标探测与跟踪
- 通信导航：实现远距离信息传输
- 无线定位：通过多普勒效应测量速度

### 优势
- 传输距离远（可达数百公里）
- 抗干扰能力强（可通过编码提升）
- 适合高速数据传输

### 注意事项
- 高频信号易受大气衰减影响
- 需要精密的天线系统
- 采样处理复杂度高

## 原文证据
> 射频信号的一般时域表达式：x(t) = a(t)cos[2πf0t + φ(t)]

> 常用雷达工作频率范围：220MHz～35GHz

> 车载毫米波雷达主要有24GHz、60GHz、77GHz、79GHz四个频段

> 射频信号均为带通实信号

## 关联知识
- [[concept-radar-signal-processing]] 雷达信号处理全流程
- [[concept-baseband-signal-processing]] 基带信号处理技术
- [[entity-cfar-processing]] 恒虚警处理算法
- [[concept-doppler-spectrum-analysis]] 多普勒频谱分析方法

来源：`src-20260601-2026-9-雷达信号处理`

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
