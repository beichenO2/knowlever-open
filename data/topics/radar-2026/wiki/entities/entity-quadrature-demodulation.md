---
id: "entity-quadrature-demodulation"
 title: 正交解调
 type: entity
 node_type: entity
 entity_type: method
 summary: 通过I路和Q路双通道解调提取射频信号的复包络，实现基带信号处理
 status: draft
 confidence: 0.8
 tags:
   - 基带处理
   - 信号解调
   - 雷达信号处理
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

# 正交解调

## 定义
正交解调是雷达信号处理中的核心方法，通过将射频信号分解为I路（同相）和Q路（正交）双通道信号，提取复包络信号以实现基带处理。该方法属于雷达信号处理领域的基础技术，是基带信号处理的前置步骤。

## 详细属性
| 参数 | 规格 | 说明 |
|------|------|------|
| 输入信号 | 射频信号 | x(t) = a(t)cos[2πf₀t + φ(t)] |
| 输出信号 | 复基带信号 | z(t) = a(t)e^{j[2πf₀t + φ(t)]} |
| 采样率 | ≥2f₀ | 满足奈奎斯特采样定理 |
| 适用场景 | 雷达、通信系统 | 高频信号处理 |
| 处理复杂度 | 中等 | 需双通道同步采样 |

## 工作原理
正交解调通过将射频信号与本地振荡器产生的正交信号（cos和sin）相乘，分离出信号的幅度和相位信息。具体步骤包括：1）将射频信号分解为I路和Q路；2）通过希尔伯特变换生成正交分量；3）合成复包络信号z(t) = I(t) + jQ(t)；4）通过移频操作得到基带信号r(t) = z(t)e^{-j2πf₀t}。该过程保留了射频信号的全部信息，便于后续数字处理。

## 使用场景与优缺点
### 应用场景
- 雷达系统中目标回波信号处理
- 通信系统中调制信号解调
- 高频信号的数字化处理

### 优点
- 保留射频信号全部信息
- 降低采样率需求
- 提取幅度和相位双信息

### 缺点
- 需双通道同步采样
- 对相位误差敏感
- 需要高性能ADC器件

### 注意事项
- 保持I路和Q路相位正交性
- 需要精确的本地振荡器
- 需要处理相位模糊问题

## 原文证据
> 射频信号的一般时域表达式：x(t) = a(t)cos[2πf₀t + φ(t)]

> 正交解调的频域分析：Z(f) = X(f) + sign(f)·X(f)

> 时域推导：z(t) = a(t)e^{j[2πf₀t + φ(t)]}，r(t) = z(t)e^{-j2πf₀t} = a(t)e^{jφ(t)}

## 关联知识
- [[entity-rf-signal]] 射频信号的时域表达式及频谱特性
- [[concept-baseband-signal-processing]] 基带信号处理流程
- [[concept-doppler-spectrum-analysis]] 多普均谱分析技术
- [[entity-cfar-processing]] 恒虚警处理算法原理
- [[concept-ambiguity-function-properties]] 模糊函数特性

来源：`src-20260601-2026-9-雷达信号处理`

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
