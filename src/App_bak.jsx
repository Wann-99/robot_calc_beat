import React, { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";

/* ================= 优化的自动循环识别算法 (保持逻辑完全不变) ================= */
const splitCyclesAuto = (nodes) => {
  if (!nodes || nodes.length === 0) return [];
  const posMap = {};
  nodes.forEach((n, i) => {
    if (!posMap[n.name]) posMap[n.name] = [];
    posMap[n.name].push(i);
  });

  let bestNode = null; let bestScore = 0; let bestPattern = null;

  Object.entries(posMap).forEach(([name, positions]) => {
    if (positions.length < 2) return; 
    const diffs = [];
    for (let i = 1; i < positions.length; i++) {
      diffs.push(positions[i] - positions[i - 1]);
    }
    const avg = diffs.reduce((a,b)=>a+b,0) / diffs.length;
    const variance = diffs.reduce((a,b)=>a+(b-avg)*(b-avg),0) / diffs.length;
    const stability = 1 / (1 + Math.sqrt(variance));
    const lengthScore = avg >= 2 && avg <= 15 ? 1.2 : 1;
    const score = positions.length * stability * lengthScore;

    if (score > bestScore) {
      bestScore = score; bestNode = name; bestPattern = { positions, avgInterval: avg, diffs };
    }
  });

  if (!bestNode || !bestPattern || bestScore < 1.0) {
    return [{ type: "all", nodes, total: nodes.reduce((a,b)=>a+b.time,0) }];
  }

  const { positions } = bestPattern;
  const groups = [];

  if (positions[0] > 0) {
    const init = nodes.slice(0, positions[0]);
    groups.push({ type: "init", nodes: init, total: init.reduce((a,b)=>a+b.time,0) });
  }

  let loopIndex = 1;
  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i];
    const end = positions[i + 1];
    const slice = nodes.slice(start, end);
    groups.push({
      type: "loop", index: loopIndex++, nodes: slice,
      total: slice.reduce((a,b)=>a+b.time,0), triggerNode: bestNode
    });
  }

  const lastPos = positions[positions.length - 1];
  if (lastPos < nodes.length) {
    const tail = nodes.slice(lastPos);
    const hasLoopNode = tail.some(n => n.name === bestNode);
    groups.push({
      type: hasLoopNode ? "tail" : "cleanup", nodes: tail,
      total: tail.reduce((a,b)=>a+b.time,0)
    });
  }
  return groups;
};

/* ================= 视觉配置优化 ================= */
const GROUP_CONFIG = {
  init: { icon: "🚀", label: "初始化", gradient: "bg-slate-50", borderColor: "border-slate-200", badgeColor: "bg-slate-400", textColor: "text-slate-700", lightColor: "bg-white" },
  loop: { icon: "🔄", label: "循环", gradient: "bg-blue-50/50", borderColor: "border-blue-200", badgeColor: "bg-blue-500", textColor: "text-blue-700", lightColor: "bg-white" },
  tail: { icon: "⚠️", label: "尾部异常", gradient: "bg-orange-50/50", borderColor: "border-orange-200", badgeColor: "bg-orange-500", textColor: "text-orange-700", lightColor: "bg-white" },
  cleanup: { icon: "🧹", label: "清理阶段", gradient: "bg-emerald-50/50", borderColor: "border-emerald-200", badgeColor: "bg-emerald-500", textColor: "text-emerald-700", lightColor: "bg-white" },
  all: { icon: "📋", label: "完整序列", gradient: "bg-purple-50/50", borderColor: "border-purple-200", badgeColor: "bg-purple-500", textColor: "text-purple-700", lightColor: "bg-white" }
};

export default function App() {
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState({});
  // 改为记录当前选中的 Plan，用于左侧目录高亮和右侧数据展示
  const [activePlan, setActivePlan] = useState(null); 
  const [rawText, setRawText] = useState("");

  const [planFilter, setPlanFilter] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // Parse 逻辑完全保留
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
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    const parsedData = parseLog(text);
    setResult(parsedData);
    
    // 自动选中第一个 Plan
    const plans = Object.keys(parsedData);
    if (plans.length > 0) setActivePlan(plans[0]);
  };

  const applyFilter = () => {
    if (rawText) {
      const parsedData = parseLog(rawText);
      setResult(parsedData);
      const plans = Object.keys(parsedData);
      if (plans.length > 0 && !plans.includes(activePlan)) {
        setActivePlan(plans[0]);
      }
    }
  };

  // 当前激活的数据
  const activeData = result && activePlan ? result[activePlan] : null;

  return (
    <div className="h-screen w-full flex flex-col bg-[#f8fafc] font-sans text-slate-800 overflow-hidden">
      
      {/* 顶部工具栏 (Header) */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-lg shadow-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 leading-none">RCA.log-PLAN时间分析</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <input 
            type="text" placeholder="搜索 Plan..." value={planFilter} onChange={e=>setPlanFilter(e.target.value)} 
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-sm transition-all shadow-inner w-32 md:w-40" 
          />
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 shadow-inner">
            <input type="datetime-local" value={startTime} onChange={e=>setStartTime(e.target.value)} className="px-1 py-2 text-xs text-slate-600 outline-none bg-transparent" />
            <span className="text-slate-300">-</span>
            <input type="datetime-local" value={endTime} onChange={e=>setEndTime(e.target.value)} className="px-1 py-2 text-xs text-slate-600 outline-none bg-transparent" />
          </div>
          <button className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-all shadow-md active:scale-95" onClick={applyFilter}>
            筛选
          </button>
          
          <div className="w-px h-6 bg-slate-200 mx-1"></div>

          <label className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors shadow-sm text-sm font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            导入文件
            <input type="file" onChange={handleFile} className="hidden" />
          </label>
        </div>
      </header>

      {/* 主体布局：左侧目录 + 右侧内容 */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 左侧边栏 (Sidebar - 目录) */}
        <aside className="w-72 bg-white border-r border-slate-200 flex flex-col flex-shrink-0 z-0">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">解析的 Plan 列表</span>
            {result && <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">{Object.keys(result).length}</span>}
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {!result ? (
              <div className="p-4 text-center text-sm text-slate-400 mt-10">
                暂无数据，请先导入日志
              </div>
            ) : (
              Object.keys(result).map((plan) => {
                const isActive = activePlan === plan;
                const data = result[plan];
                const hasError = data.anomalies.length > 0;
                
                return (
                  <button
                    key={plan}
                    onClick={() => setActivePlan(plan)}
                    className={`w-full text-left px-3 py-3 rounded-lg flex items-center justify-between transition-all duration-200 ${
                      isActive 
                        ? "bg-blue-50 border border-blue-100 shadow-sm" 
                        : "hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <div className={`text-sm font-semibold truncate font-mono ${isActive ? 'text-blue-700' : 'text-slate-700'}`} title={plan}>
                        {plan}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                        <span>Avg: {data.avg.toFixed(2)}s</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                        {data.count} 次
                      </span>
                      {hasError && <span className="w-2 h-2 rounded-full bg-red-400"></span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 右侧主内容区 (Main Workspace) */}
        <main className="flex-1 overflow-y-auto bg-slate-50/50 relative">
          {!activeData ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <p className="text-lg font-medium">请从左侧选择一个 Plan 以查看详情</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div 
                key={activePlan} // 依赖项改变时触发动画
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="p-6 md:p-8 max-w-7xl mx-auto space-y-6"
              >
                {/* 标题与核心指标 */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                  <h2 className="text-2xl font-bold text-slate-800 font-mono tracking-tight mb-6 flex items-center gap-3">
                    <span className="w-2 h-6 bg-blue-500 rounded-full inline-block"></span>
                    {activePlan}
                  </h2>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 divide-x divide-slate-100">
                    {[
                      ["执行总次数", activeData.count, "次", "bg-blue-50 text-blue-600"], 
                      ["平均节拍", activeData.avg.toFixed(3), "s", "bg-indigo-50 text-indigo-600"], 
                      ["最大耗时", activeData.max.toFixed(3), "s", "bg-rose-50 text-rose-600"], 
                      ["最小耗时", activeData.min.toFixed(3), "s", "bg-emerald-50 text-emerald-600"]
                    ].map(([label, value, unit, colorClass], idx)=>(
                      <div key={label} className={`flex flex-col ${idx !== 0 ? 'pl-6' : ''}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-2 h-2 rounded-full ${colorClass.split(' ')[0].replace('bg-', 'bg-').replace('50', '400')}`}></span>
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-extrabold text-slate-800 tabular-nums tracking-tight">{value}</span>
                          <span className="text-sm font-medium text-slate-400">{unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 异常报告 */}
                {activeData.anomalies.length > 0 && (
                  <div className="bg-red-50/80 rounded-2xl border border-red-100 p-5">
                    <h3 className="text-red-700 font-bold mb-3 flex items-center gap-2 text-sm">
                      <span className="bg-white text-red-500 p-1 rounded-md shadow-sm">⚠️</span> 检测到异常执行
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {activeData.anomalies.map(a=>(
                        <div key={a.index} className="text-xs text-red-700 bg-white px-3 py-2 rounded-lg border border-red-100 shadow-sm flex items-center gap-2">
                          <span className="font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded">Run #{a.index}</span>
                          <span className="opacity-90">{a.issues.join("，")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 图表区 */}
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* 趋势图 */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="mb-4 text-slate-700 font-bold flex items-center gap-2 text-sm">
                      <span className="bg-slate-100 text-slate-500 p-1.5 rounded-lg">📈</span> 每次执行总耗时趋势
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={trendData[activePlan]} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="index" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip 
                          contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                          itemStyle={{color: '#0f172a', fontWeight: 600}}
                        />
                        <Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={2.5} dot={{fill: '#3b82f6', strokeWidth: 2, r: 3}} activeDot={{r: 5, strokeWidth: 0}} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* 节点排行 */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <h3 className="mb-4 text-slate-700 font-bold flex items-center gap-2 text-sm">
                      <span className="bg-slate-100 text-slate-500 p-1.5 rounded-lg">📊</span> 单节点平均耗时 (Top)
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={activeData.nodes} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="node" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} interval={0} tick={{width: 50}} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip 
                          cursor={{fill: '#f8fafc'}}
                          contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                        />
                        <Bar dataKey="avg" radius={[4, 4, 0, 0]} maxBarSize={32}>
                          {activeData.nodes.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 ? "#f43f5e" : "#94a3b8"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 执行流与循环结构分析 */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <h3 className="text-slate-800 font-bold flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg">🔄</span> 
                      节点执行流拆解与循环识别
                    </h3>
                    <span className="text-xs text-slate-500">共 {activeData.rawRuns.length} 次运行记录</span>
                  </div>
                  
                  <div className="p-5 space-y-6">
                    {activeData.rawRuns.map((run, i) => {
                      const totalTime = run.groups?.reduce((sum,g)=>sum+g.total,0) || 0;
                      const loopGroups = run.groups?.filter(g => g.type === 'loop') || [];
                      const hasLoops = loopGroups.length > 0;
                      
                      return (
                        <div key={i} className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                          {/* Run Header */}
                          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
                            <div className="flex items-center gap-3">
                              <span className="bg-slate-800 text-white w-6 h-6 rounded flex items-center justify-center text-xs font-bold shadow-sm">{i+1}</span>
                              <span className="text-sm font-bold text-slate-700">运行记录 #{i+1}</span>
                              {hasLoops && (
                                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold tracking-wide">
                                  发现 {loopGroups.length} 个循环体
                                </span>
                              )}
                            </div>
                            <div className="text-sm font-bold text-slate-800 tabular-nums bg-slate-100 px-3 py-1 rounded-md">
                              总耗时: {totalTime.toFixed(3)}s
                            </div>
                          </div>
                          
                          {/* 阶段列表 */}
                          <div className="p-3 flex flex-col gap-2">
                            {run.groups?.map((g, gi) => {
                              const config = GROUP_CONFIG[g.type];
                              const percentage = totalTime > 0 ? (g.total / totalTime * 100).toFixed(1) : 0;
                              
                              return (
                                <div key={gi} className={`flex flex-col border rounded-lg overflow-hidden ${config.borderColor} ${config.gradient}`}>
                                  <div className="flex flex-wrap items-center justify-between px-4 py-2.5 gap-4">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-7 h-7 rounded-md flex items-center justify-center text-sm bg-white shadow-sm border ${config.borderColor}`}>
                                        {config.icon}
                                      </div>
                                      <div>
                                        <div className={`text-sm font-bold ${config.textColor} flex items-center gap-2`}>
                                          {g.type === 'loop' ? `${config.label} ${g.index}` : config.label}
                                          {g.triggerNode && (
                                            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-white/80 border border-black/5">
                                              Trigger: {g.triggerNode}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-4">
                                      <div className="hidden sm:flex flex-col items-end w-24">
                                        <div className="w-full h-1.5 bg-slate-200/60 rounded-full overflow-hidden mb-1">
                                          <div className={`h-full ${config.badgeColor} rounded-full`} style={{width: `${percentage}%`}} />
                                        </div>
                                        <span className="text-[10px] text-slate-500 font-medium">{percentage}% 占比</span>
                                      </div>
                                      <div className={`text-sm font-bold tabular-nums ${config.textColor} bg-white/60 px-2 py-1 rounded border border-white`}>
                                        {g.total.toFixed(3)}s
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {/* 节点 Chips */}
                                  <div className="px-3 py-2.5 bg-white/50 border-t border-black/5 flex flex-wrap gap-1.5">
                                    {g.nodes.map((n, ni)=>(
                                      <div key={ni} className="inline-flex items-center bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
                                        <span className="px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-50">
                                          {n.name}
                                        </span>
                                        <span className="w-px h-full bg-slate-100"></span>
                                        <span className={`px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${config.textColor}`}>
                                          {n.time.toFixed(3)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* 添加一点针对侧边栏滚动条的全局样式 */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb { background: #94a3b8; }
      `}} />
    </div>
  );
}