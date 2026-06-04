/**
 * tech-decisions SDK — 横切技术取舍记录。
 *
 * 每个 stage 完成时调用 recordDecision() 写入 tech-decisions.json。
 * Stage 5 通过后调用 writeAudit() 写入 audit 段。
 * Stage 6/7 读取此文件渲染为产物内独立页。
 */

const fs = require('fs');
const path = require('path');

function loadOrCreate(filePath) {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return {
    compiled_at: new Date().toISOString(),
    topic: '',
    decisions: [],
    audit: null,
  };
}

function save(filePath, data) {
  data.compiled_at = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function recordDecision(outputDir, topic, decision) {
  const filePath = path.join(outputDir, 'tech-decisions.json');
  const data = loadOrCreate(filePath);
  data.topic = topic;

  const existing = data.decisions.findIndex(
    d => d.stage === decision.stage && d.name === decision.name
  );
  if (existing >= 0) {
    data.decisions[existing] = decision;
  } else {
    data.decisions.push(decision);
  }

  save(filePath, data);
}

function writeAudit(outputDir, audit) {
  const filePath = path.join(outputDir, 'tech-decisions.json');
  const data = loadOrCreate(filePath);
  data.audit = audit;
  save(filePath, data);
}

function load(outputDir) {
  const filePath = path.join(outputDir, 'tech-decisions.json');
  return loadOrCreate(filePath);
}

module.exports = { recordDecision, writeAudit, load };
