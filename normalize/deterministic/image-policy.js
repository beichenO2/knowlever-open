#!/usr/bin/env node
/**
 * KnowLever Image Policy — three-level filtering.
 *
 * Core principle: 只学算法、不学操作 (learn algorithms, not app operations).
 * Keep: charts with analytical annotations, structural diagrams, pattern illustrations.
 * Drop: app/software navigation screenshots, text documents, decorative images.
 *
 * Level 1: Does this domain need images at all?
 *   - Biology/Chemistry/Pharmacy diagrams → YES (visually irreplaceable)
 *   - Futures/Stock key chart patterns → YES (formations must be seen)
 *   - Math/Physics diagrams → NO (can be described textually, formulas suffice)
 *   - General finance/trading lectures → NO (text captures the knowledge)
 *
 * Level 2: Heuristic fast-pass/reject (filename, filesize, OCR density)
 *   - Filename "方法/趋势/K线" → keep
 *   - Filename "文档/说明" → reject (ocrOnly)
 *   - Batch > BATCH_VLM_THRESHOLD → flag for VLM review
 *
 * Level 3: VLM Agent investigation (batch trigger)
 *   - Step 1: 6-class classification (CHART/DIAGRAM/PHOTO/TEXT_SCREENSHOT/APP_SCREENSHOT/DECORATIVE)
 *   - Step 2: For CHART results, refine: teaching material vs app screenshot
 *   - VLM failure → reject (少而精 principle)
 */

/**
 * keepArchitecture: always true — 架构图/系统图/流程图是所有知识整理的刚需
 * keepDomainImages: whether to also keep domain-specific images beyond architecture diagrams
 */
const DOMAIN_IMAGE_POLICY = {
  'medical':    { keepImages: true,  keepDomainImages: true,  reason: '医学 — 关键配图不可替代 + 架构图' },
  'pharma':     { keepImages: true,  keepDomainImages: true,  reason: '药学 — 结构式/机制图/标本照片 + 架构图' },
  'biology':    { keepImages: true,  keepDomainImages: true,  reason: '生物学 — 细胞/组织/标本图 + 架构图' },
  'chemistry':  { keepImages: true,  keepDomainImages: true,  reason: '化学 — 结构式/反应机理图 + 架构图' },
  'trading':    { keepImages: true,  keepDomainImages: true,  reason: '期货股票 — K线形态/指标图 + 架构图' },
  'quant':      { keepImages: true,  keepDomainImages: true,  reason: '量化交易 — 关键策略形态图 + 架构图' },
  'math':       { keepImages: true,  keepDomainImages: false, reason: '数学 — 仅保留架构图' },
  'physics':    { keepImages: true,  keepDomainImages: false, reason: '物理 — 仅保留架构图' },
  'finance':    { keepImages: true,  keepDomainImages: false, reason: '金融讲课 — 仅保留架构图' },
  'tech':       { keepImages: true,  keepDomainImages: false, reason: '技术 — 仅保留架构图' },
  'academic':   { keepImages: true,  keepDomainImages: true,  reason: '学术 — 实验数据/图表 + 架构图' },
  'general':    { keepImages: true,  keepDomainImages: false, reason: '通用领域 — 仅保留架构图' },
};

/**
 * Level 1: Should this domain keep images at all?
 * @param {string} domain
 * @returns {{ keepImages: boolean, reason: string }}
 */
function shouldDomainKeepImages(domain) {
  const key = (domain || 'general').toLowerCase();
  return DOMAIN_IMAGE_POLICY[key] || DOMAIN_IMAGE_POLICY['general'];
}

const BATCH_VLM_THRESHOLD = 10;

const IMAGE_CLASSIFY_PROMPT = `你是一个图片分类器。请判断这张图片属于以下哪个类别：

1. DIAGRAM — 架构图、系统图、流程图、层次结构图、组件关系图、UML图、网络拓扑图
2. CHART — 数据图表（曲线、走势图、K线图、指标图、柱状图、散点图）
3. PHOTO — 实物照片（标本、设备、实验等主题相关实物）
4. TEXT_SCREENSHOT — 主要是文字内容（文档截图、聊天记录、说明文字、笔记、PPT文字页）
5. APP_SCREENSHOT — 软件/App界面截图（交易软件、网页界面等日常操作界面）
6. DECORATIVE — 标识、图标、背景、与主题无关的装饰

仅回复类别名（如 "DIAGRAM" 或 "TEXT_SCREENSHOT"），不要任何解释。`;

const IMAGE_REFINE_PROMPT = '这张图片是教学素材（教概念/方法/指标用法的教材）还是交易App截图（东方财富/同花顺等App里某只票的行情页面）？仅回复"教学"或"App截图"。';

const CLASSIFICATION_MAP = {
  CHART:           { keep: 'domain',  ocrOnly: false, reason: 'VLM判定: 图表/曲线', refine: true },
  DIAGRAM:         { keep: 'always',  ocrOnly: false, reason: 'VLM判定: 架构图/流程图/系统图' },
  PHOTO:           { keep: 'domain',  ocrOnly: false, reason: 'VLM判定: 实物照片' },
  TEXT_SCREENSHOT:  { keep: false,    ocrOnly: true,  reason: 'VLM判定: 文字截图 → 仅提取文字' },
  APP_SCREENSHOT:  { keep: false,    ocrOnly: false, reason: 'VLM判定: App行情截图' },
  DECORATIVE:      { keep: false,    ocrOnly: false, reason: 'VLM判定: 装饰/无关图' },
};

function parseRefineResponse(vlmResponse) {
  if (!vlmResponse) return null;
  const text = vlmResponse.trim().toLowerCase();
  if (/教学|教材|概念|方法|素材/.test(text.slice(0, 30))) return 'teaching';
  if (/app|截图|东方|同花顺|行情|交易软件/.test(text.slice(0, 30))) return 'app';
  return null;
}

/**
 * Parse VLM classification response.
 * Priority: 1) explicit "属于/is" pattern  2) bold-emphasized category  3) first match
 */
function parseClassification(vlmResponse) {
  if (!vlmResponse) return null;
  const text = vlmResponse.trim();
  const keys = Object.keys(CLASSIFICATION_MAP);

  const directMatch = text.match(/(?:属于|归为|判定为|is|classified as)\s*\**\s*(?:\d+\.\s*)?([\w_]+)/i);
  if (directMatch) {
    const candidate = directMatch[1].toUpperCase();
    for (const key of keys) {
      if (candidate.includes(key)) return key;
    }
  }

  const boldMatch = text.match(/\*\*(?:\d+\.\s*)?([\w_]+)\*\*/);
  if (boldMatch) {
    const candidate = boldMatch[1].toUpperCase();
    for (const key of keys) {
      if (candidate.includes(key)) return key;
    }
  }

  const cleaned = text.toUpperCase().replace(/[^A-Z_]/g, '');
  for (const key of keys) {
    if (cleaned.includes(key)) return key;
  }
  return null;
}

/**
 * Level 2: Is this specific image worth keeping as a visual?
 * Only called when Level 1 says keepImages=true.
 *
 * Core principle: keep charts/diagrams/structures, discard text-heavy screenshots.
 *
 * When batch exceeds BATCH_VLM_THRESHOLD, images that can't be definitively
 * classified by heuristics get flagged with needsVLMReview=true — the caller
 * should invoke a VLM agent to classify them before making the final decision.
 *
 * @param {object} context
 * @param {number} context.fileSize - bytes
 * @param {string} [context.ocrText] - extracted OCR text (if available)
 * @param {string} [context.filename]
 * @param {number} [context.batchIndex] - position in batch
 * @param {number} [context.batchTotal] - total images in batch
 * @returns {{ keep: boolean, reason: string, priority: number, ocrOnly?: boolean, needsVLMReview?: boolean }}
 */
function shouldKeepImage(context = {}) {
  const { fileSize = 0, ocrText, filename = '', batchIndex = 0, batchTotal = 1 } = context;

  if (fileSize > 0 && fileSize < 5000) {
    return { keep: false, reason: '小于 5KB — 大概率是图标/装饰', priority: 0 };
  }

  const textDocPattern = /文档|说明|注意事项|安装|字体|聊天|截屏|微信图片|wechat|screenshot|document|readme/i;
  if (textDocPattern.test(filename)) {
    return { keep: false, reason: '文件名暗示纯文字截图 — 应 OCR 提取文字', priority: 1, ocrOnly: true };
  }

  const appOpPattern = /软件|app|下载|安装|注册|登录|界面|操作|导航|菜单|设置/i;
  if (appOpPattern.test(filename)) {
    return { keep: false, reason: '文件名暗示App操作指引 — 只学算法不学操作', priority: 1 };
  }

  const chartPattern = /chart|diagram|figure|fig\d|结构|机制|形态|k线|pattern|趋势|走势|曲线|指标|方法|macd|rsi|均线|布林/i;
  if (chartPattern.test(filename)) {
    return { keep: true, reason: '文件名暗示关键图表/形态', priority: 9 };
  }

  if (ocrText) {
    const textLen = ocrText.trim().length;
    const lineCount = ocrText.split('\n').filter(l => l.trim()).length;
    if (textLen > 300 && lineCount > 10) {
      return { keep: false, reason: '文字密集(>300字,>10行) — 纯文字截图，应 OCR 提取', priority: 1, ocrOnly: true };
    }
    if (textLen > 0 && textLen < 100) {
      return { keep: true, reason: '少量文字+图表 — 大概率是带标注的图表', priority: 8 };
    }
  }

  if (fileSize > 2 * 1024 * 1024 && !ocrText) {
    return { keep: false, reason: '大文件(>2MB)无 OCR — 大概率是高清照片/背景', priority: 2 };
  }

  if (batchTotal > BATCH_VLM_THRESHOLD) {
    return { keep: true, reason: '大批次待 VLM 调查', priority: 5, needsVLMReview: true };
  }

  return { keep: true, reason: '默认保留（少而精原则下后续可人工复核）', priority: 5 };
}

/**
 * Auto-detect domain from topic name or content text.
 * More granular than digist — distinguishes pharma/bio/chem from generic medical.
 */
function detectDomain(topicName, contentHint) {
  const rawText = `${topicName || ''} ${contentHint || ''}`;
  const textLines = rawText.split('\n').filter(l => !/^!\[|https?:\/\//.test(l.trim()));
  const text = textLines.join(' ').toLowerCase();

  if (/pharm|药学|药理|药物|药剂|处方|阿司匹林|布洛芬/.test(text)) return 'pharma';
  if (/\bbio\b|生物|细胞|基因|蛋白|遗传/.test(text)) return 'biology';
  if (/\bchem(?:istry|ical)?\b|化学|反应式|分子|有机|无机|结构式/.test(text)) return 'chemistry';
  if (/medical|医学|临床|诊断|病理|症状/.test(text)) return 'medical';
  if (/quant|量化|策略|回测|alpha/.test(text)) return 'quant';
  if (/trading|交易|期货|股票|k线|形态|\betf\b|futures|training/.test(text)) return 'trading';
  if (/\bmath\b|数学|微积分|线性代数|概率/.test(text)) return 'math';
  if (/physics|物理|力学|电磁|量子/.test(text)) return 'physics';
  if (/\bfinance\b|金融|投资|理财|基金/.test(text)) return 'finance';
  if (/\btech\b|技术|编程|代码|框架|\bapi\b/.test(text)) return 'tech';
  if (/研究|论文|实验|学术|methodology/.test(text)) return 'academic';

  return 'general';
}

module.exports = {
  shouldDomainKeepImages,
  shouldKeepImage,
  detectDomain,
  parseClassification,
  parseRefineResponse,
  DOMAIN_IMAGE_POLICY,
  CLASSIFICATION_MAP,
  IMAGE_CLASSIFY_PROMPT,
  IMAGE_REFINE_PROMPT,
  BATCH_VLM_THRESHOLD,
};
