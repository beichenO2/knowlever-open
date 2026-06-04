---
id: "entity-pulse-doppler-radar"
 title: 脉冲多普勒雷达
 type: entity
 node_type: entity
 entity_type: module
 summary: 利用多普勒效应和频域滤波技术实现动目标检测的雷达系统，通过PRF优化解决速度模糊和杂波干扰问题
 status: draft
 confidence: 0.8
 tags:
   - 雷达技术
   - 信号处理
   - 杂波抑制
   - 多普勒效应
   - PRF设计
   - 动目标检测
 source_ids:
   - src-20260601-2026-10-脉冲多普勒雷达
 parent_ids:
   - concept-motion-target-detection
 related_ids:
   - concept-doppler-filter-bank
   - concept-no-clutter-zone
   - entity-prf
 created: 2026-06-01
 updated: 2026-06-01
---

# 脉冲多普勒雷达

## 定义
脉冲多普勒（Pulse Doppler, PD）雷达是一种通过多普勒效应检测目标速度、利用频域滤波抑制杂波的雷达系统。该技术属于雷达信号处理领域，是运动目标检测（[[concept-motion-target-detection]]）的核心实现方式，通过PRF优化解决传统雷达的速度模糊问题。

## 详细属性
| 参数 | 规格 | 说明 |
|------|------|------|
| 工作原理 | 多普勒效应+频域滤波 | 通过目标运动产生的频率偏移检测速度 |
| PRF分类 | 低/中/高 | 影响距离模糊与速度模糊特性 |
| 探测距离 | 远/中/近 | 依赖PRF选择与杂波抑制能力 |
| 杂波抑制 | 频域滤波 | 通过窄带滤波器组分离目标信号 |
| 适用场景 | 机载预警/导弹制导 | 需要强杂波环境下检测动目标 |

## 工作原理
PD雷达通过发射相参脉冲串信号，接收回波后利用多普勒频移特性提取目标速度信息。其核心机制包括：

1. **多普勒频移分析**：目标运动导致回波频率偏移，计算公式为：
   `f_d = (2v_R / λ) cosφ`（其中v_R为载机速度，λ为波长，φ为夹角）

2. **频域滤波处理**：采用窄带滤波器组（[[concept-doppler-filter-bank]]）提取特定多普勒频率信号，抑制主瓣/旁瓣杂波。

3. **PRF优化设计**：通过选择合适脉冲重复频率（[[entity-prf]]）平衡距离分辨率与速度分辨率，避免模糊现象。高PRF模式下存在距离模糊，低PRF模式下存在速度模糊。

## 使用场景与优缺点
### 应用场景
- 机载预警系统（如空警2000）
- 导弹制导与火控系统
- 地面监视与战场监测
- 气象雷达（高分辨率速度检测）

### 优点
- 强杂波环境下仍能检测动目标
- 速度分辨力优于传统脉冲雷达
- 通过PRF选择实现无杂波区（[[concept-no-clutter-zone]]）

### 缺点
- 高PRF模式下存在距离模糊
- 低PRF模式下速度模糊问题
- 需要复杂信号处理算法

### 注意事项
- PRF选择需平衡距离与速度分辨率
- 需配合CFAR处理（恒虚警率）提升检测能力
- 天线副瓣抑制对杂波抑制效果显著

## 原文证据
1. "PD雷达具有足够高的脉冲重复频率，没有速度模糊"（[[src-20260601-2026-10-脉冲多普勒雷达]]）
2. "无杂波区的出现与脉冲重复频率fr、载机速度vr和发射信号的波长有关"（[[src-20260601-2026-10-脉冲多普勒雷达]]）
3. "主瓣杂波强度最高，干扰最强，其次是高度线杂波"（[[src-20260601-2026-10-脉冲多普勒雷达]]）

## 关联知识
- [[entity-prf]]：PRF参数对雷达性能的影响
- [[concept-doppler-filter-bank]]：多普均滤波器组设计
- [[concept-no-clutter-zone]]：无杂波区形成条件
- [[concept-motion-target-detection]]：运动目标检测技术原理
- [[entity-radar-emission]]：雷达发射机与信号特性

来源：`2026-10-脉冲多普勒雷达.pdf`（AutoOffice to-markdown）

<div align="right" style="opacity: 0.5; font-size: 0.8em;">✨ <i>Compiled by MiniMax-M2.7-highspeed</i></div>
