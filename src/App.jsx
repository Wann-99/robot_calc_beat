import React, { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";

/* ================= 优化的自动循环识别算法 ================= */
const splitCyclesAuto = (nodes) => {
  if (!nodes || nodes.length === 0) return [];

  // 1️⃣ 收集所有节点的位置
  const posMap = {};
  nodes.forEach((n, i) => {
    if (!posMap[n.name]) posMap[n.name] = [];
    posMap[n.name].push(i);
  });

  // 2️⃣ 找最佳循环节点（降低阈值到2次）
  let bestNode = null;
  let bestScore = 0;
  let bestPattern = null;

  Object.entries(posMap).forEach(([name, positions]) => {
    if (positions.length < 2) return; // 关键修复：从3次降到2次

    // 计算间隔
    const diffs = [];
    for (let i = 1; i < positions.length; i++) {
      diffs.push(positions[i] - positions[i - 1]);
    }

    // 检查规律性
    const avg = diffs.reduce((a,b)=>a+b,0) / diffs.length;
    const variance = diffs.reduce((a,b)=>a+(b-avg)*(b-avg),0) / diffs.length;
    
    // 评分：频率 * 稳定性 * 长度适中度
    const stability = 1 / (1 + Math.sqrt(variance));
    const lengthScore = avg >= 2 && avg <= 15 ? 1.2 : 1;
    const score = positions.length * stability * lengthScore;

    if (score > bestScore) {
      bestScore = score;
      bestNode = name;
      bestPattern = { positions, avgInterval: avg, diffs };
    }
  });

  // 未找到有效循环模式
  if (!bestNode || !bestPattern || bestScore < 1.0) {
    return [{
      type: "all",
      nodes,
      total: nodes.reduce((a,b)=>a+b.time,0)
    }];
  }

  const { positions } = bestPattern;
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
      total: slice.reduce((a,b)=>a+b.time,0),
      triggerNode: bestNode
    });
  }

  // 尾部段
  const lastPos = positions[positions.length - 1];
  if (lastPos < nodes.length) {
    const tail = nodes.slice(lastPos);
    const hasLoopNode = tail.some(n => n.name === bestNode);
    groups.push({
      type: hasLoopNode ? "tail" : "cleanup",
      nodes: tail,
      total: tail.reduce((a,b)=>a+b.time,0)
    });
  }

  return groups;
};

// 视觉配置
const GROUP_CONFIG = {
  init: { icon: "🚀", label: "初始化", gradient: "from-slate-100 to-gray-50", borderColor: "border-slate-300", badgeColor: "bg-slate-500", textColor: "text-slate-700", lightColor: "bg-slate-100", description: "启动准备" },
  loop: { icon: "🔄", label: "主循环", gradient: "from-indigo-100 via-blue-50 to-cyan-50", borderColor: "border-indigo-400", badgeColor: "bg-indigo-500", textColor: "text-indigo-700", lightColor: "bg-indigo-100", description: "核心循环" },
  tail: { icon: "⚠️", label: "尾部异常", gradient: "from-red-100 via-orange-50 to-amber-50", borderColor: "border-red-400", badgeColor: "bg-red-500", textColor: "text-red-700", lightColor: "bg-red-100", description: "异常收尾" },
  cleanup: { icon: "🧹", label: "清理阶段", gradient: "from-emerald-100 to-teal-50", borderColor: "border-emerald-300", badgeColor: "bg-emerald-500", textColor: "text-emerald-700", lightColor: "bg-emerald-100", description: "正常结束" },
  all: { icon: "📋", label: "完整序列", gradient: "from-violet-100 via-purple-50 to-pink-50", borderColor: "border-violet-400", badgeColor: "bg-violet-500", textColor: "text-violet-700", lightColor: "bg-violet-100", description: "无循环模式" }
};

export default function App() {
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState({});
  const [expandedPlan, setExpandedPlan] = useState(null);
  const [rawText, setRawText] = useState("");

  const [planFilter, setPlanFilter] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

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
        currentRun = { nodes: {}, nodeSeq: [], startTime: lastTimestamp };
        planRuns[currentPlan].push(currentRun);
      }

      const nodeMatch = line.match(/node \[(.*?)\] time : ([\d\.]+)/);
      if (nodeMatch && currentRun) {
        const node = nodeMatch[1];
        const time = parseFloat(nodeMatch[2]);
        if (!currentRun.nodes[node]) currentRun.nodes[node] = [];
        currentRun.nodes[node].push(time);
        currentRun.nodeSeq.push({ name: node, time: time });
      }

      const totalMatch = line.match(/Total Time = ([\d\.]+)/);
      if (totalMatch && currentRun) {
        currentRun.total = parseFloat(totalMatch[1]);
        currentRun.groups = splitCyclesAuto(currentRun.nodeSeq);
        currentRun = null;
      }
    });

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

      summary[plan] = { avg, max, min, count: filteredRuns.length, nodes, rawRuns: filteredRuns, anomalies };
      trend[plan] = totals.map((t,i)=>({index:i+1, time:t}));
    });

    setTrendData(trend);
    return summary;
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    const text = await file.text();
    setRawText(text);
    setResult(parseLog(text));
  };

  const applyFilter = () => {
    if (rawText) setResult(parseLog(rawText));
  };

  return (
    <div className="p-8 min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50">
      <h1 className="text-4xl font-bold text-center mb-6 text-indigo-700">
        节拍分析平台（智能循环识别版）
      </h1>

      <div className="flex flex-col md:flex-row justify-center items-center gap-4 mb-8">
        <input type="text" placeholder="Plan名称" value={planFilter} onChange={e=>setPlanFilter(e.target.value)} className="px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
        <input type="datetime-local" value={startTime} onChange={e=>setStartTime(e.target.value)} className="px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
        <input type="datetime-local" value={endTime} onChange={e=>setEndTime(e.target.value)} className="px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
        <button className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition shadow-lg" onClick={applyFilter}>应用筛选</button>
        <input type="file" onChange={handleFile} className="px-4 py-2 border rounded-xl shadow-sm file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-indigo-100 file:text-indigo-700" />
      </div>

      {result && Object.entries(result).map(([plan, data])=>{
        const expanded = expandedPlan===plan;
        return (
          <div key={plan} className="mb-6">
            <div onClick={()=>setExpandedPlan(expanded ? null : plan)} className="bg-white rounded-2xl shadow-md hover:shadow-xl transition-all p-5 cursor-pointer border border-gray-100">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-indigo-800">{plan}</h2>
                <span className="text-gray-400 text-lg">{expanded ? "▲" : "▼"}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                {[["执行次数", data.count], ["平均节拍", data.avg.toFixed(3)], ["最大节拍", data.max.toFixed(3)], ["最小节拍", data.min.toFixed(3)]].map(([label,value])=>(
                  <div key={label} className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl p-3 border border-indigo-100">
                    <div className="text-xs text-gray-500 mb-1">{label}</div>
                    <div className="text-lg font-bold text-indigo-700">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <AnimatePresence>
              {expanded && (
                <motion.div initial={{opacity:0, y:-10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-10}} className="mt-4 space-y-6">
                  
                  {/* 异常 */}
                  <div className="bg-white rounded-2xl shadow-lg p-5 border-l-4 border-red-400">
                    <h3 className="text-red-500 font-bold mb-3 flex items-center gap-2 text-lg">⚠️ 异常报告</h3>
                    {data.anomalies.length===0 ? (
                      <div className="text-green-600 flex items-center gap-2 bg-green-50 p-3 rounded-lg"><span className="text-xl">✅</span> 无异常</div>
                    ):(
                      <div className="space-y-2">
                        {data.anomalies.map(a=>(
                          <div key={a.index} className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200 flex items-center gap-2">
                            <span className="font-bold bg-red-200 px-2 py-0.5 rounded">#{a.index}</span>
                            <span>{a.issues.join("，")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 图表 */}
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
                      <h3 className="mb-3 text-indigo-700 font-bold flex items-center gap-2">📈 趋势图</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={trendData[plan]}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff"/>
                          <XAxis dataKey="index" stroke="#6366f1"/>
                          <YAxis stroke="#6366f1"/>
                          <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)'}}/>
                          <Line type="monotone" dataKey="time" stroke="#6366f1" strokeWidth={3} dot={{fill: '#6366f1', r: 4}} activeDot={{r: 6}}/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
                      <h3 className="mb-3 text-indigo-700 font-bold flex items-center gap-2">📊 节点分析</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data.nodes}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff"/>
                          <XAxis dataKey="node" stroke="#6366f1" fontSize={12}/>
                          <YAxis stroke="#6366f1"/>
                          <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)'}}/>
                          <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                            {data.nodes.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={index === 0 ? "#ef4444" : "#6366f1"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 循环结构分析 */}
                  <div className="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
                    <h3 className="mb-4 text-indigo-700 font-bold flex items-center gap-2 text-lg">🔄 循环结构分析</h3>
                    
                    <div className="space-y-4">
                      {data.rawRuns.map((run,i)=>{
                        const totalTime = run.groups?.reduce((sum,g)=>sum+g.total,0) || 0;
                        const loopGroups = run.groups?.filter(g => g.type === 'loop') || [];
                        const hasLoops = loopGroups.length > 0;
                        
                        return (
                          <div key={i} className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-gray-50/50 shadow-sm">
                            <div className="bg-gradient-to-r from-gray-100 to-gray-200 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="bg-indigo-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shadow-md">#{i+1}</div>
                                <span className="font-bold text-gray-700">第 {i+1} 次执行</span>
                                {hasLoops && (
                                  <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium">
                                    识别到 {loopGroups.length} 个循环
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm border border-gray-200">
                                <span className="text-gray-500 text-sm">总耗时</span>
                                <span className="font-bold text-indigo-600 text-lg">{totalTime.toFixed(3)}s</span>
                              </div>
                            </div>
                            
                            <div className="p-4 space-y-3">
                              {run.groups?.map((g,gi)=>{
                                const config = GROUP_CONFIG[g.type];
                                const percentage = totalTime > 0 ? (g.total / totalTime * 100).toFixed(1) : 0;
                                
                                return (
                                  <motion.div 
                                    key={gi}
                                    initial={{opacity: 0, x: -20}}
                                    animate={{opacity: 1, x: 0}}
                                    transition={{delay: gi * 0.08}}
                                    className={`rounded-xl border-2 ${config.borderColor} bg-gradient-to-r ${config.gradient} overflow-hidden shadow-sm hover:shadow-md transition-shadow`}
                                  >
                                    <div className="px-4 py-3 border-b border-white/60">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <div className={`w-12 h-12 rounded-xl ${config.lightColor} flex items-center justify-center text-2xl shadow-inner`}>
                                            {config.icon}
                                          </div>
                                          <div>
                                            <div className={`font-bold text-lg ${config.textColor}`}>
                                              {g.type === 'loop' ? `${config.label} ${g.index}` : config.label}
                                              {g.triggerNode && (
                                                <span className="ml-2 text-xs font-normal bg-white/50 px-2 py-0.5 rounded">
                                                  触发: {g.triggerNode}
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                              {config.description} • {g.nodes.length} 个节点
                                            </div>
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <div className={`text-2xl font-bold ${config.textColor}`}>
                                            {g.total.toFixed(3)}s
                                          </div>
                                          <div className="text-xs font-medium text-gray-500 bg-white/60 px-2 py-0.5 rounded-full inline-block mt-1">
                                            占比 {percentage}%
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    
                                    <div className="px-4 py-2 bg-white/40">
                                      <div className="h-2.5 bg-gray-200/80 rounded-full overflow-hidden shadow-inner">
                                        <motion.div 
                                          initial={{width: 0}}
                                          animate={{width: `${percentage}%`}}
                                          transition={{duration: 0.6, delay: gi * 0.1, ease: "easeOut"}}
                                          className={`h-full ${config.badgeColor} rounded-full shadow-sm`}
                                        />
                                      </div>
                                    </div>
                                    
                                    <div className="px-4 py-3 bg-white/30">
                                      <div className="flex flex-wrap gap-2">
                                        {g.nodes.map((n,ni)=>(
                                          <motion.span 
                                            key={ni}
                                            initial={{scale: 0.8, opacity: 0}}
                                            animate={{scale: 1, opacity: 1}}
                                            transition={{delay: gi * 0.1 + ni * 0.03}}
                                            className="bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm border border-gray-200/50 hover:shadow-md hover:scale-105 transition-all cursor-default"
                                          >
                                            <span className="text-gray-500 font-medium">{n.name}</span>
                                            <span className="mx-1.5 text-gray-300">|</span>
                                            <span className={`font-bold ${config.textColor}`}>{n.time.toFixed(3)}s</span>
                                          </motion.span>
                                        ))}
                                      </div>
                                    </div>
                                  </motion.div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
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