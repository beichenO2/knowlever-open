---
id: "entity-mti-processing"
 title: MTI处理
 type: entity
 node_type: entity
 entity_type: module
 summary: 通过慢时间域差分运算抑制固定目标杂波的雷达信号处理模块
 status: draft
 confidence: 0.6
 tags:
   - 雷达信号处理
   - 杂波抑制
   - 慢时间域处理
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

# MTI处理

## 定义
MTI（Moving Target Indicator）处理是雷达信号处理中的慢时间域差分运算模块，用于抑制固定目标杂波。该技术通过对比相邻距离单元的信号差异，消除多普勒频率为0的固定目标回波，属于雷达信号处理的核心模块之一，隶属于[[concept-radar-signal-processing]]体系。

## 详细属性
| 参数 | 规格 | 说明 |
|------|------|------|
| 处理域 | 慢时间域 | 采样间隔为T（脉冲重复周期） |
| 处理方式 | 差分运算 | 一次对消：y(n)=r(n)-r(n+1)；二次对消：y(n)=r(n)-2r(n+1)-r(n+2) |
| 输入信号 | 数字基带接收信号 | 距离单元宽度=脉冲宽度 |
| 输出信号 | 杂波抑制后的信号 | 保留运动目标特征 |
| 适用场景 | 地面雷达、气象雷达 | 抑制地杂波、雨雪杂波 |

## 工作原理
MTI处理通过差分运算消除固定目标杂波，其核心机制如下：

1. **一次对消**：对相邻距离单元信号进行差分运算，抑制多普勒频率为0的固定目标回波。例如：y(n) = r(n) - r(n+1)，该运算使固定目标信号被抵消，而运动目标信号保留。

2. **二次对消**：通过三次点差分运算进一步抑制固定目标，公式为y(n) = r(n) - 2r(n+1) - r(n+2)。该方法能更有效地消除固定杂波，但会减少脉冲数据量（减少k个脉冲数据）。

3. **频率特性**：MTI滤波器的频率响应特性显示，其可有效抑制多普勒频率为0的固定目标回波（如地面杂波），但对运动目标（如移动车辆）的信号保留完整。

## 使用场景与优缺点
### 使用场景
- 地面雷达：抑制地杂波，提高移动目标检测能力
- 气象雷达：消除雨雪杂波，聚焦风暴系统
- 机场雷达：区分静止飞机与移动物体

### 优点
- 有效抑制固定目标杂波
- 实现简单，计算量小
- 适用于慢时间域处理

### 缺点
- 可能引入差分噪声
- 对多普勒模糊现象无改善作用
- 无法区分不同速度的运动目标

### 注意事项
- 需配合MTD处理实现多普勒频谱分析
- 对消次数需根据杂波特性调整
- 与CFAR处理协同工作时需注意门限设置

## 原文证据
> MTI滤波器的频率特性可见：MTI滤波器可抑制多普勒频率为0的回波信号，即可抑制固定目标回波，例如地面雷达的地杂波。

> MTI处理前的数据输出：y(1)=r(1)-r(2)，y(2)=r(2)-r(3)，...，y(N-1)=r(N-1)-r(N)

> 二次对消MTI：y(n)=r(n)-2r(n+1)-r(n+2)

## 关联知识
- [[entity-baseband-signal]] 基带信号处理是MTI处理的前提
- [[concept-doppler-spectrum-analysis]] MTD处理与MTI处理共同构成多普勒分析体系
- [[entity-cfar-processing]] CFAR处理需与MTI处理结果协同工作
- [[concept-ambiguity-function-properties]] 模糊函数特性与MTI处理的杂波抑制原理相关

来源：`src-20260601-2026-9-雷达信号处理`

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
