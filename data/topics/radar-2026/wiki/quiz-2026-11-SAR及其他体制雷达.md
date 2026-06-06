---
title: "2026-11-SAR及其他体制雷达 — 练习题"
type: quiz
source: "2026-11-SAR及其他体制雷达"
---

# 2026-11-SAR及其他体制雷达 — 练习题

> 本页包含 1 道练习题，来自原始教学材料。

## 题 1

信息与通信工程学院
                                             D
例: 求ERS-1/-2 SAR 分辨力
天线孔径: L  10m 入射角：  23
信号带宽: B  15.55MHz
                                                 θ
飞行高度：H sat  785km
目标典型距离：R  853km
                                                     R
距离向分辨力：
           c            3 108                            θ
 Rr                                    25 m       R
       2 B sin  2 15.55 106 sin(23 )                r


                                  R
方位向分辨力：真实孔径：R                        853000  0.056 /10  5 km
                                   D
                                  D
                 合成孔径：R   10 / 2  5 m
                                  2

<details>
<summary>查看解答</summary>

**已知参数**
- 天线物理孔径 $D = L = 10 \text{ m}$
- 入射角 $\theta = 23^\circ$
- 信号带宽 $B = 15.55 \text{ MHz} = 1.555 \times 10^7 \text{ Hz}$
- 斜距 $R = 853 \text{ km} = 8.53 \times 10^5 \text{ m}$
- 光速 $c = 3 \times 10^8 \text{ m/s}$
- 雷达波长 $\lambda = 0.056 \text{ m}$（ERS-1/2 为 C 波段，由题中计算过程反推给出）

---

**1. 距离向分辨力计算**
距离向分辨力通常指地面距离向分辨力，其表达式为：
$$\Delta R_r = \frac{c}{2 B \sin \theta}$$

代入已知数值：
$$\Delta R_r = \frac{3 \times 10^8}{2 \times 15.55 \times 10^6 \times \sin(23^\circ)}$$

计算中间值：
$$\sin(23^\circ) \approx 0.39073$$
分母 $= 2 \times 15.55 \times 10^6 \times 0.39073 \approx 1.2152 \times 10^7$

得出结果：
$$\Delta R_r = \frac{3 \times 10^8}{1.2152 \times 10^7} \approx 24.69 \text{ m} \approx 25 \text{ m}$$

*(注：斜距分辨力为
$$\frac{c}{2B} \approx 9.65 \text{ m}$$
，地面分辨力需除以 $\sin\theta$ 进行投影转换。)*

---

**2. 方位向分辨力计算（真实孔径雷达 RAR）**
真实孔径雷达的方位分辨力由天线波束在地面的照射宽度决定：
$$\Delta R_\alpha = \frac{R \lambda}{D}$$

代入已知数值：
$$\Delta R_\alpha = \frac{8.53 \times 10^5 \times 0.056}{10}$$

计算过程：
$$8.53 \times 10^5 \times 0.056 = 47768$$
$$\Delta R_\alpha = \frac{47768}{10} = 4776.8 \text{ m} \approx 4.78 \text{ km} \approx 5 \text{ km}$$

---

**3. 方位向分辨力计算（合成孔径雷达 SAR）**
合成孔径雷达利用平台运动合成等效大孔径，其理论方位分辨力仅取决于天线物理长度：
$$\Delta R_\alpha' = \frac{D}{2}$$

代入已知数值：
$$\Delta R_\alpha' = \frac{10}{2} = 5 \text{ m}$$

*(注：SAR 方位分辨力与斜距 $R$、波长 $\lambda$ 均无关，这是合成孔径技术的核心优势。)*

---
**最终结果汇总**
- 距离向（地面）分辨力：
$$\Delta R_r \approx 25 \text{ m}$$
- 真实孔径方位分辨力：
$$\Delta R_\alpha \approx 5 \text{ km}$$
- 合成孔径方位分辨力：
$$\Delta R_\alpha' = 5 \text{ m}$$

</details>

---

