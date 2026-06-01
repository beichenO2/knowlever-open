---
id: "entity-auto-angle-tracking"
title: "自动测角系统"
type: entity
node_type: entity
entity_type: system
summary: 实现目标角度实时跟踪的闭环控制系统
status: draft
confidence: 0.65
tags:
  - 雷达系统
  - 自动控制
  - 角度测量
source_ids:
  - src-20260601-2026目标角度测量
parent_ids:
  - concept-auto-angle-tracking
related_ids:
  - entity-phase-angle-measurement
  - entity-amplitude-angle-measurement
  - concept-beam-scanning
created: 2026-06-01
updated: 2026-06-01
---

# 自动测角系统

## 定义
自动测角系统是雷达系统中实现目标角度实时跟踪的闭环控制系统，属于角度测量技术领域。该系统通过天线波束扫描和信号处理算法，持续监测目标方位角变化并自动调整天线指向，其核心原理与[[concept-auto-angle-tracking]]中的圆锥扫描和单脉冲测角技术密切相关。

## 详细属性
| 参数 | 规格 | 工作条件 |
|------|-----|----------|
| 扫描方式 | 圆锥扫描/单脉冲 | 需配合相位法或振幅法测角 |
| 精度 | ±0.1°（典型值） | 环境温度-40℃~+60℃ |
| 响应时间 | <10ms | 供电电压24V±15% |
| 适用场景 | 空中交通管制、防空火控、卫星跟踪 |

## 工作原理
自动测角系统通过以下机制实现目标跟踪：
1. **圆锥扫描**：天线波束以角速度ωs绕等信号轴旋转，形成圆锥轨迹，目标偏离轴线时产生强度变化
2. **误差鉴别**：角误差鉴别器将目标偏离量转换为误差电压，其值正比于偏离角度ε
3. **闭环控制**：误差电压经放大处理后控制天线转向，使轴线对准目标
4. **多模式切换**：支持相位法/振幅法测角，通过差频比相或等信号法实现高精度定位

## 使用场景与优缺点
### 应用场景
- 空中交通管制：实时监控飞行器位置
- 防空火控：精确跟踪空中目标
- 卫星跟踪：维持天线对准轨道卫星

### 优点
- 高精度（可达0.1°）
- 实时跟踪能力
- 抗干扰能力强

### 缺点
- 系统复杂度高
- 需要稳定电源环境
- 对机械磨损敏感

### 注意事项
- 定期校准误差鉴别器
- 避免强电磁干扰环境
- 保持天线机械结构稳定

## 原文证据
> "目标偏离轴线（即出现误差角ε），产生一个误差电压，其值正比于ε，极性随偏离方向不同而改变。误差电压经跟踪系统变换、放大、处理后，控制天线向减小ε方向运动，使天线轴线对准目标。"

> "圆锥扫描自动测角系统通过波束旋转实现目标定位跟踪"

## 关联知识
- [[entity-phase-angle-measurement]]（相位法测角原理）
- [[entity-amplitude-angle-measurement]]（振幅法测角技术）
- [[concept-beam-scanning]]（波束扫描方法）
- [[concept-multi-valued-problem]]（相位法多值性问题）

来源：`2026目标角度测量.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
