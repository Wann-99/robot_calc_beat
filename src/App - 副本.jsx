import React, { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
  BarChart, Bar
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";

/* ================= 自动识别主循环节点 ================= */
const splitCyclesAuto = (nodes) => {
  if (!nodes || nodes.length === 0) return [];

  // 1️⃣ 收集位置
  const posMap = {};
  nodes.forEach((n, i) => {
    if (!posMap[n.name]) posMap[n.name] = [];
    posMap[n.name].push(i);
  });

  // 2️⃣ 找最佳循环节点
  let bestNode = null;
  let bestScore = 0;

  Object.entries(posMap).forEach(([name, positions]) => {
    if (positions.length < 3) return;

    const diffs = [];
    for (let i = 1; i < positions.length; i++) {
      diffs.push(positions[i] - positions[i - 1]);
    }

    const avg = diffs.reduce((a,b)=>a+b,0)/diffs.length;
    const variance = diffs.reduce((a,b)=>a+(b-avg)*(b-avg),0)/diffs.length;

    const stability = 1 / (1 + variance);
    const score = positions.length * stability;

    if (score > bestScore) {
      bestScore = score;
      bestNode = name;
    }
  });

  // 没找到规律
  if (!bestNode) {
    return [{
      type: "all",
      nodes,
      total: nodes.reduce((a,b)=>a+b.time,0)
    }];
  }

  const positions = posMap[bestNode];
  const groups = [];

  // 初始化段
  if (positions[0] > 0) {
    const init = nodes.slice(0, positions[0]);
    groups.push({
      type: "init",
      nodes: init,
      total: init.reduce((a,b)=>a+b.time,0)
    });
  }

  // 循环段
  let loopIndex = 1;
  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i];
    const end = positions[i + 1];

    const slice = nodes.slice(start, end);

    groups.push({
      type: "loop",
      index: loopIndex++,
      nodes: slice,
      total: slice.reduce((a,b)=>a+b.time,0)
    });
  }

  // 尾部异常
  const lastPos = positions[positions.length - 1];
  if (lastPos < nodes.length) {
    const tail = nodes.slice(lastPos);
    groups.push({
      type: "tail",
      nodes: tail,
      total: tail.reduce((a,b)=>a+b.time,0)
    });
  }

  return groups;
};

export default function App() {
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState({});
  const [expandedPlan, setExpandedPlan] = useState(null);

  const [planFilter, setPlanFilter] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  /* ================= 解析 ================= */
  const parseLog = (text) => {
    const lines = text.split("\n");
    let currentPlan = null;
    let currentRun = null;
    let lastTimestamp = null;

    const planRuns = {};

    lines.forEach(line => {
      const timeMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
      if (timeMatch) lastTimestamp = new Date(timeMatch[1]);

      const planMatch = line.match(/====== Plan \[(.*?)\]/);
      if (planMatch) {
        currentPlan = planMatch[1];
        if (!planRuns[currentPlan]) planRuns[currentPlan] = [];
        currentRun = {
          nodes: {},
          nodeSeq: [],
          startTime: lastTimestamp
        };
        planRuns[currentPlan].push(currentRun);
      }

      const nodeMatch = line.match(/node \[(.*?)\] time : ([\d\.]+)/);
      if (nodeMatch && currentRun) {
        const node = nodeMatch[1];
        const time = parseFloat(nodeMatch[2]);

        if (!currentRun.nodes[node]) currentRun.nodes[node] = [];
        currentRun.nodes[node].push(time);

        currentRun.nodeSeq.push({
          name: node,
          time: time
        });
      }

      const totalMatch = line.match(/Total Time = ([\d\.]+)/);
      if (totalMatch && currentRun) {
        currentRun.total = parseFloat(totalMatch[1]);

        // ⭐ 自动循环识别
        currentRun.groups = splitCyclesAuto(currentRun.nodeSeq);

        currentRun = null;
      }
    });

    /* ================= 统计 ================= */
    const summary = {};
    const trend = {};

    Object.entries(planRuns).forEach(([plan, runs]) => {

      if (planFilter && !plan.includes(planFilter)) return;

      const filteredRuns = runs.filter(run => {
        const t = run.startTime?.getTime();
        if (startTime && t < new Date(startTime).getTime()) return false;
        if (endTime && t > new Date(endTime).getTime()) return false;
        return true;
      });

      if (filteredRuns.length === 0) return;

      const totals = filteredRuns.filter(r=>r.total!==undefined).map(r=>r.total);
      if (totals.length===0) return;

      const avg = totals.reduce((a,b)=>a+b,0)/totals.length;
      const max = Math.max(...totals);
      const min = Math.min(...totals);

      const nodeMap = {};
      filteredRuns.forEach(run=>{
        Object.entries(run.nodes).forEach(([n, ts])=>{
          if (!nodeMap[n]) nodeMap[n] = [];
          nodeMap[n].push(...ts);
        });
      });

      const nodes = Object.entries(nodeMap).map(([node, ts])=>{
        const navg = ts.reduce((a,b)=>a+b,0)/ts.length;
        return { node, avg: navg, max: Math.max(...ts), min: Math.min(...ts) };
      }).sort((a,b)=>b.avg-a.avg);

      const anomalies = [];
      filteredRuns.forEach((run, i)=>{
        const issues = [];
        if (run.total===undefined) issues.push("缺失Total");
        else if (run.total>avg*1.2) issues.push("Total过高");

        run.issues = issues;
        if (issues.length>0) anomalies.push({ index: i+1, issues });
      });

      summary[plan] = {
        avg, max, min, count: filteredRuns.length,
        nodes, rawRuns: filteredRuns, anomalies
      };

      trend[plan] = totals.map((t,i)=>({index:i+1, time:t}));
    });

    setTrendData(trend);
    return summary;
  };

  const handleFile = async (e) => {
    const text = await e.target.files[0].text();
    setResult(parseLog(text));
  };

  return (
    <div className="p-8 min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50">
      <h1 className="text-4xl font-bold text-center mb-6 text-indigo-700">
        节拍分析平台（自动循环识别版）
      </h1>

      {/* 筛选 */}
      <div className="flex flex-wrap justify-center gap-4 mb-8">
        <input placeholder="Plan名称" value={planFilter} onChange={e=>setPlanFilter(e.target.value)} className="px-3 py-2 border rounded-xl"/>
        <input type="datetime-local" value={startTime} onChange={e=>setStartTime(e.target.value)} className="px-3 py-2 border rounded-xl"/>
        <input type="datetime-local" value={endTime} onChange={e=>setEndTime(e.target.value)} className="px-3 py-2 border rounded-xl"/>
        <input type="file" onChange={handleFile} className="px-4 py-2 border rounded-xl"/>
      </div>

      {/* 展示 */}
      {result && Object.entries(result).map(([plan, data])=>{
        const expanded = expandedPlan===plan;

        return (
          <div key={plan} className="mb-6">

            <div onClick={()=>setExpandedPlan(expanded?null:plan)}
              className="bg-white p-5 rounded-2xl shadow cursor-pointer">
              <div className="flex justify-between">
                <span className="font-semibold">{plan}</span>
                <span>{expanded?"▲":"▼"}</span>
              </div>
            </div>

            <AnimatePresence>
              {expanded && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} className="mt-4 space-y-4">

                  {/* 循环结构 */}
                  <div className="bg-white p-4 rounded-xl shadow">
                    <h3 className="mb-3 text-indigo-600">循环结构分析（自动识别）</h3>

                    {data.rawRuns.map((run,i)=>(
                      <div key={i} className="mb-3 border p-3 rounded">

                        <div className="text-sm mb-2">第 {i+1} 次</div>

                        {run.groups?.map((g,gi)=>(
                          <div key={gi} className={`mb-2 p-2 rounded border
                            ${g.type==="loop"?"bg-indigo-50":
                              g.type==="init"?"bg-gray-100":"bg-red-50"}`}>

                            <div className="flex justify-between text-xs mb-1">
                              <span>
                                {g.type==="init" && "初始化段"}
                                {g.type==="loop" && `循环 ${g.index}`}
                                {g.type==="tail" && "尾部异常"}
                              </span>
                              <span>{g.total.toFixed(3)} s</span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {g.nodes.map((n,ni)=>(
                                <span key={ni} className="bg-white px-2 py-0.5 rounded text-xs">
                                  {n.name}:{n.time.toFixed(3)}
                                </span>
                              ))}
                            </div>

                          </div>
                        ))}

                      </div>
                    ))}
                  </div>

                </motion.div>
              )}
            </AnimatePresence>

          </div>
        );
      })}
    </div>
  );
}