import React, { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { DatePicker, ConfigProvider, Select } from "antd";
import locale from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");

const { RangePicker } = DatePicker;

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
    
    let simScore = 0;
    let simCount = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      const nextPos = i + 2 < positions.length ? positions[i+2] : nodes.length;
      
      const slice1 = nodes.slice(positions[i], positions[i+1]);
      const slice2 = nodes.slice(positions[i+1], nextPos);
      
      let matches = 0;
      const compareLen = Math.min(slice1.length, slice2.length);
      for(let j=0; j<compareLen; j++){
        if (slice1[j].name === slice2[j].name) matches++;
      }
      
      const sim = slice1.length > 0 ? matches / slice1.length : 0;
      simScore += sim;
      simCount++;
    }
    
    const avgSim = simCount > 0 ? simScore / simCount : 0;
    const score = positions.length * stability * lengthScore * Math.pow(avgSim, 2);

    if (score > bestScore) {
      bestScore = score; bestNode = name; bestPattern = { positions, avgInterval: avg, diffs, avgSim };
    }
  });

  if (!bestNode || !bestPattern || bestScore < 0.1) {
    return [{ type: "all", nodes, total: nodes.reduce((a,b)=>a+b.time,0) }];
  }

  let b = [...bestPattern.positions];
  let maxShift = 0;
  
  while (true) {
    const shift = maxShift + 1;
    if (b[0] - shift < 0) break;
    
    let allMatch = true;
    const refNode = nodes[b[0] - shift].name;
    for (let i = 1; i < b.length; i++) {
      if (b[i] - shift < 0 || nodes[b[i] - shift].name !== refNode) {
        allMatch = false;
        break;
      }
    }
    
    if (allMatch) {
      maxShift = shift;
    } else {
      break;
    }
  }

  for (let i = 0; i < b.length; i++) {
    b[i] -= maxShift;
  }

  const groups = [];

  if (b[0] > 0) {
    const init = nodes.slice(0, b[0]);
    groups.push({ type: "init", nodes: init, total: init.reduce((a,b)=>a+b.time,0) });
  }

  let loopIndex = 1;
  for (let i = 0; i < b.length - 1; i++) {
    const start = b[i];
    const end = b[i + 1];
    const slice = nodes.slice(start, end);
    groups.push({
      type: "loop", index: loopIndex++, nodes: slice,
      total: slice.reduce((a,b)=>a+b.time,0), triggerNode: bestNode
    });
  }

  const lastPos = b[b.length - 1];
  if (lastPos < nodes.length) {
    let tail = nodes.slice(lastPos);
    
    while (tail.length > 0) {
      let extracted = false;
      
      if (groups.length > 0 && groups[groups.length - 1].type === "loop") {
        const prevLoop = groups[groups.length - 1].nodes;
        const loopStartNode = prevLoop[0].name;
        
        let nextStartRelIdx = -1;
        const minLen = Math.max(1, Math.floor(prevLoop.length * 0.5));
        
        for (let i = minLen; i < tail.length; i++) {
          if (tail[i].name === loopStartNode) {
            let matches = 0;
            const compareLen = Math.min(i, prevLoop.length);
            for (let j = 0; j < compareLen; j++) {
              if (tail[j].name === prevLoop[j].name) matches++;
            }
            if (matches / compareLen >= 0.7) {
              nextStartRelIdx = i;
              break;
            }
          }
        }
        
        if (nextStartRelIdx === -1 && tail.length >= prevLoop.length) {
          let matches = 0;
          for (let i = 0; i < prevLoop.length; i++) {
            if (tail[i].name === prevLoop[i].name) matches++;
          }
          if (matches / prevLoop.length >= 0.8) {
            nextStartRelIdx = prevLoop.length;
          }
        }
        
        if (nextStartRelIdx !== -1) {
          const extraLoop = tail.slice(0, nextStartRelIdx);
          groups.push({
            type: "loop", index: loopIndex++, nodes: extraLoop,
            total: extraLoop.reduce((a,b)=>a+b.time,0), triggerNode: bestNode
          });
          tail = tail.slice(nextStartRelIdx);
          extracted = true;
        }
      }
      
      if (!extracted) break;
    }

    if (tail.length > 0) {
      const hasLoopNode = tail.some(n => n.name === bestNode);
      groups.push({
        type: hasLoopNode ? "tail" : "cleanup", nodes: tail,
        total: tail.reduce((a,b)=>a+b.time,0)
      });
    }
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

// 简单的两向混淆加密，避免 F12 直接看到明文，同时允许管理员解密查看
const SECRET_KEY = "RCALOG_2026";
const encodePwd = (str) => {
  let encoded = "";
  for (let i = 0; i < str.length; i++) {
    encoded += String.fromCharCode(str.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length));
  }
  return btoa(encoded);
};
const decodePwd = (b64) => {
  try {
    let decoded = atob(b64);
    let str = "";
    for (let i = 0; i < decoded.length; i++) {
      str += String.fromCharCode(decoded.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length));
    }
    return str;
  } catch (e) {
    return "";
  }
};

export default function App() {
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState({});
  // 改为记录当前选中的 Plan，用于左侧目录高亮和右侧数据展示
  const [activePlan, setActivePlan] = useState(null); 
  const [rawText, setRawText] = useState("");
  const [fileMeta, setFileMeta] = useState(null);

  const [planFilter, setPlanFilter] = useState("");
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);
  const [filterNotice, setFilterNotice] = useState(null);
  
  // 新增 appState 来控制页面生命周期
  const [appState, setAppState] = useState("splash"); // "splash" | "welcome" | "dashboard"
  
  // 新增侧边栏状态和宽度控制
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(288); // 默认 w-72 (72*4=288px)
  const [isResizing, setIsResizing] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiTargetPlan, setAiTargetPlan] = useState(null);
  const [showAISettings, setShowAISettings] = useState(false);
  
  // 新增：账号体系与鉴权状态
  const [accounts, setAccounts] = useState(() => {
    const saved = localStorage.getItem('APP_ACCOUNTS');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.admin && parsed.admin.passwordEncoded) {
        return parsed;
      } else {
        localStorage.removeItem('APP_ACCOUNTS');
      }
    }
    return {
      admin: { username: 'admin', passwordEncoded: encodePwd('admin123') },
      users: [{ username: 'user', passwordEncoded: encodePwd('user123') }]
    };
  });
  const [loggedInRole, setLoggedInRole] = useState(() => localStorage.getItem('LOGGED_IN_ROLE') || null); // 'admin' | 'user' | null
  const [loggedInUsername, setLoggedInUsername] = useState(() => localStorage.getItem('LOGGED_IN_USERNAME') || null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [loginError, setLoginError] = useState('');
  const [pendingAction, setPendingAction] = useState(null); // 'generate' | 'settings'

  // 新增：历史登录账号记录与下拉控制
  const [loginHistory, setLoginHistory] = useState(() => {
    const saved = localStorage.getItem('LOGIN_HISTORY');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);

  // 新增：设置面板里的状态 (多用户与日志)
  const [balanceInfo, setBalanceInfo] = useState('');
  const [adminTab, setAdminTab] = useState('users'); // 'users' | 'logs'
  const [newUserForm, setNewUserForm] = useState({ username: '', password: '' });
  
  // 新增：AI 请求日志
  const [aiLogs, setAiLogs] = useState(() => {
    const saved = localStorage.getItem('AI_LOGS');
    return saved ? JSON.parse(saved) : [];
  });
  
  // AI 中止请求控制器
  const abortControllerRef = useRef(null);

  const [aiConfig, setAiConfig] = useState(() => {
    const saved = localStorage.getItem('AI_CONFIG');
    return saved ? JSON.parse(saved) : {
      baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
      model: 'moonshot-v1-8k',
      apiKey: ''
    };
  });
  
  // 新增：下拉菜单与密码修改状态
  const [showDropdown, setShowDropdown] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [myPwdForm, setMyPwdForm] = useState({ oldPwd: '', newPwd: '' });
  
  // 记录每个 Plan 下各 Run 的展开/折叠状态
  const [expandedRuns, setExpandedRuns] = useState({});

  // 拖拽改变侧边栏宽度逻辑
  const startResizing = React.useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (e) => {
      if (isResizing) {
        const newWidth = e.clientX;
        if (newWidth >= 240 && newWidth <= 600) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  // 启动动画控制：从 splash 平滑过渡到 login
  useEffect(() => {
    if (appState === "splash") {
      const timer = setTimeout(() => {
        setAppState("login");
      }, 2000); 
      return () => clearTimeout(timer);
    }
  }, [appState]);

  // 每次切换 activePlan 时，默认折叠所有，展开第一个，并同步更新 aiTargetPlan（如果为空）
  useEffect(() => {
    setExpandedRuns({ 0: true });
    if (activePlan) setAiTargetPlan(activePlan);
  }, [activePlan]);

  useEffect(() => {
    if (!filterNotice) return;
    const t = setTimeout(() => setFilterNotice(null), 3500);
    return () => clearTimeout(t);
  }, [filterNotice]);

  const toggleRun = (index) => {
    setExpandedRuns(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Parse 逻辑完全保留
  const parseLog = (text) => {
    const lines = text.split("\n");
    let currentPlan = null;
    let currentRun = null;
    let lastTimestamp = null;
    const planRuns = {};

    lines.forEach(line => {
      // 提取时间戳并保存为标准格式的字符串，避免浏览器原生 Date 解析的兼容性问题
      const timeMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
      if (timeMatch) {
        // dayjs 能完美解析这种格式，所以直接存字符串即可
        lastTimestamp = timeMatch[1];
      }

      const planMatch = line.match(/====== Plan \[(.*?)\]/);
      if (planMatch) {
        currentPlan = planMatch[1];
        if (!planRuns[currentPlan]) planRuns[currentPlan] = [];
        // startTime 取当前已知的最新系统打印时间
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
      if (planFilter && !plan.toLowerCase().includes(planFilter.toLowerCase())) return;
      const filteredRuns = runs.filter(run => {
        if (!run.startTime) return true; // 如果没有时间戳则不过滤
        const t = dayjs(run.startTime).valueOf();
        
        // startTime 和 endTime 是 dayjs 对象
        if (startTime) {
          if (t < startTime.valueOf()) return false;
        }
        if (endTime) {
          if (t > endTime.valueOf()) return false;
        }
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
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // 校验所有文件扩展名
    const invalidFiles = files.filter(f => !f.name.toLowerCase().endsWith('.log'));
    if (invalidFiles.length > 0) {
      alert("错误：只允许导入 .log 格式的日志文件");
      e.target.value = null;
      return;
    }

    // 按照文件名或最后修改时间排序，保证日志的时间线顺序拼接
    files.sort((a, b) => a.name.localeCompare(b.name));

    // 计算总大小和显示名称，并把所有文件的名字和大小存入数组
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    const fileInfos = files.map(f => ({ name: f.name, size: f.size }));
    setFileMeta({ 
      isMultiple: files.length > 1,
      totalSize: totalSize,
      files: fileInfos 
    });

    // 并发读取所有文件内容
    const textPromises = files.map(file => file.text());
    const texts = await Promise.all(textPromises);
    
    // 按顺序拼接日志内容
    const combinedText = texts.join('\n');
    
    setRawText(combinedText);
    const parsedData = parseLog(combinedText);
    setResult(parsedData);
    
    // 自动选中第一个 Plan
    const plans = Object.keys(parsedData);
    if (plans.length > 0) setActivePlan(plans[0]);
    
    // 成功导入数据后，进入仪表盘主界面
    setAppState("dashboard");
    
    // 清空 file input 的 value，允许连续上传同名文件触发 onChange
    e.target.value = null;
  };

  const applyFilter = () => {
    if (rawText) {
      const parsedData = parseLog(rawText);
      const plans = Object.keys(parsedData);
      if (plans.length === 0) {
        setFilterNotice("当前筛选范围内没有数据，请重新选择时间范围");
        return;
      }
      setFilterNotice(null);
      setResult(parsedData);
      if (!plans.includes(activePlan)) setActivePlan(plans[0]);
    }
  };

  // 当前激活的数据
  const activeData = result && activePlan ? result[activePlan] : null;

  // 保存 AI 配置
  const saveAiConfig = (newConfig) => {
    setAiConfig(newConfig);
    localStorage.setItem('AI_CONFIG', JSON.stringify(newConfig));
    setShowAISettings(false);
  };

  const handleLoginSubmit = () => {
    if (loginForm.username === accounts.admin.username && loginForm.password === decodePwd(accounts.admin.passwordEncoded)) {
      const newHistory = [loginForm.username, ...loginHistory.filter(u => u !== loginForm.username)].slice(0, 5);
      setLoginHistory(newHistory);
      localStorage.setItem('LOGIN_HISTORY', JSON.stringify(newHistory));

      setLoggedInRole('admin');
      setLoggedInUsername('admin');
      localStorage.setItem('LOGGED_IN_ROLE', 'admin');
      localStorage.setItem('LOGGED_IN_USERNAME', 'admin');
      setShowLoginModal(false);
      setLoginError('');
      if (pendingAction === 'settings') setShowAISettings(true);
      if (pendingAction === 'generate') handleGenerateAIReport();
      if (!pendingAction) setAppState('welcome');
    } else {
      const foundUser = accounts.users.find(u => u.username === loginForm.username && decodePwd(u.passwordEncoded) === loginForm.password);
      if (foundUser) {
        const newHistory = [foundUser.username, ...loginHistory.filter(u => u !== foundUser.username)].slice(0, 5);
        setLoginHistory(newHistory);
        localStorage.setItem('LOGIN_HISTORY', JSON.stringify(newHistory));

        setLoggedInRole('user');
        setLoggedInUsername(foundUser.username);
        localStorage.setItem('LOGGED_IN_ROLE', 'user');
        localStorage.setItem('LOGGED_IN_USERNAME', foundUser.username);
        setShowLoginModal(false);
        setLoginError('');
        if (pendingAction === 'settings') {
          alert('权限不足：只有管理员可以访问设置。');
        }
        if (pendingAction === 'generate') handleGenerateAIReport();
        if (!pendingAction) setAppState('welcome');
      } else {
        setLoginError('账号或密码错误');
      }
    }
  };

  const handleRegisterSubmit = () => {
    const { username, password, confirmPassword } = registerForm;
    if (!username || !password) {
      setLoginError('用户名和密码不能为空');
      return;
    }
    if (password !== confirmPassword) {
      setLoginError('两次输入的密码不一致');
      return;
    }
    if (username === 'admin' || accounts.users.some(u => u.username === username)) {
      setLoginError('用户名已被注册，请更换一个');
      return;
    }

    const newAccounts = {
      ...accounts,
      users: [...accounts.users, { username, passwordEncoded: encodePwd(password) }]
    };
    setAccounts(newAccounts);
    localStorage.setItem('APP_ACCOUNTS', JSON.stringify(newAccounts));

    const newHistory = [username, ...loginHistory.filter(u => u !== username)].slice(0, 5);
    setLoginHistory(newHistory);
    localStorage.setItem('LOGIN_HISTORY', JSON.stringify(newHistory));

    // 自动登录
    setLoggedInRole('user');
    setLoggedInUsername(username);
    localStorage.setItem('LOGGED_IN_ROLE', 'user');
    localStorage.setItem('LOGGED_IN_USERNAME', username);
    setLoginError('');
    setRegisterForm({ username: '', password: '', confirmPassword: '' });
    if (pendingAction === 'generate') handleGenerateAIReport();
    if (!pendingAction) setAppState('welcome');
  };

  const triggerGenerateAI = () => {
    if (loggedInRole) handleGenerateAIReport();
    else {
      setPendingAction('generate');
      setLoginForm({ username: '', password: '' });
      setLoginError('');
      setShowLoginModal(true);
    }
  };

  const triggerSettings = () => {
    if (loggedInRole === 'admin') setShowAISettings(true);
    else if (loggedInRole === 'user') alert('权限不足：只有管理员可以配置系统。');
    else {
      setPendingAction('settings');
      setLoginForm({ username: '', password: '' });
      setLoginError('');
      setShowLoginModal(true);
    }
  };

  const checkAIBalance = async () => {
    setBalanceInfo('查询中...');
    try {
      let res, data;
      if (aiConfig.baseUrl.includes('moonshot.cn')) {
        res = await fetch('https://api.moonshot.cn/v1/users/me/balance', { headers: { 'Authorization': `Bearer ${aiConfig.apiKey}` } });
        data = await res.json();
        if (data.data) setBalanceInfo(`剩余可用额度: ${data.data.available_balance} 元`);
        else throw new Error('解析失败');
      } else if (aiConfig.baseUrl.includes('deepseek.com')) {
        res = await fetch('https://api.deepseek.com/user/balance', { headers: { 'Authorization': `Bearer ${aiConfig.apiKey}`, 'Accept': 'application/json' } });
        data = await res.json();
        if (data.is_available) {
           const cny = data.balance_infos?.find(b => b.currency === 'CNY');
           setBalanceInfo(`剩余可用额度: ${cny ? cny.total_balance : 0} 元`);
        } else throw new Error('解析失败');
      } else {
        setBalanceInfo('当前 API 平台暂不支持自动查询余额');
      }
    } catch (e) {
      setBalanceInfo('查询失败: ' + e.message);
    }
  };

  const addAiLog = (username, plan, status) => {
    const newLog = {
      id: Date.now(),
      username,
      plan,
      status,
      time: new Date().toLocaleString()
    };
    setAiLogs(prev => {
      const updated = [newLog, ...prev].slice(0, 100); // 只保留最近100条
      localStorage.setItem('AI_LOGS', JSON.stringify(updated));
      return updated;
    });
  };

  const [adminPwdForm, setAdminPwdForm] = useState({ newPwd: '' });

  const handleUpdateAdminPwd = () => {
    if (!adminPwdForm.newPwd) {
      alert('新密码不能为空');
      return;
    }
    if (window.confirm('确定要修改管理员密码吗？下次登录将使用新密码。')) {
      const newAccounts = {
        ...accounts,
        admin: { ...accounts.admin, passwordEncoded: encodePwd(adminPwdForm.newPwd) }
      };
      setAccounts(newAccounts);
      localStorage.setItem('APP_ACCOUNTS', JSON.stringify(newAccounts));
      setAdminPwdForm({ newPwd: '' });
      alert('管理员密码修改成功！');
    }
  };

  const handleAddUser = () => {
    if (!newUserForm.username || !newUserForm.password) {
      alert('用户名和密码不能为空');
      return;
    }
    if (accounts.users.some(u => u.username === newUserForm.username) || newUserForm.username === 'admin') {
      alert('用户名已存在');
      return;
    }
    
    const newAccounts = {
      ...accounts,
      users: [...accounts.users, { username: newUserForm.username, passwordEncoded: encodePwd(newUserForm.password) }]
    };
    setAccounts(newAccounts);
    localStorage.setItem('APP_ACCOUNTS', JSON.stringify(newAccounts));
    setNewUserForm({ username: '', password: '' });
  };

  const handleDeleteUser = (username) => {
    if (!window.confirm(`确定要删除用户 ${username} 吗？`)) return;
    const newAccounts = {
      ...accounts,
      users: accounts.users.filter(u => u.username !== username)
    };
    setAccounts(newAccounts);
    localStorage.setItem('APP_ACCOUNTS', JSON.stringify(newAccounts));
  };

  const cancelAIGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // 生成 AI 分析报告
  const handleGenerateAIReport = async () => {
    const targetData = result && aiTargetPlan ? result[aiTargetPlan] : null;
    if (!targetData || !aiTargetPlan) {
      alert("请先选择一个有效的 Plan");
      return;
    }

    if (!aiConfig.apiKey) {
      if (loggedInRole === 'admin') {
        alert("请先设置 API Key 和模型参数");
        setShowAISettings(true);
      } else {
        alert("系统尚未配置 AI 密钥，请联系管理员配置。");
      }
      return;
    }

    setIsGeneratingAI(true);
    abortControllerRef.current = new AbortController();

    try {
      const promptText = `
你是一个专业的机器人系统性能分析专家。请根据以下日志分析数据，生成一份专业的性能诊断报告。

【基础信息】
- 分析对象 (Plan)：${aiTargetPlan}
- 运行总次数：${targetData.count} 次
- 平均耗时：${targetData.avg.toFixed(3)} s
- 最大耗时：${targetData.max.toFixed(3)} s
- 最小耗时：${targetData.min.toFixed(3)} s

【耗时最高的节点 (Top 5)】
${targetData.nodes.slice(0, 5).map(n => `- ${n.node}: 平均 ${n.avg.toFixed(3)}s (最大 ${n.max.toFixed(3)}s)`).join('\n')}

【异常运行记录】
${targetData.anomalies.length > 0 ? targetData.anomalies.slice(0,10).map(a => `- 运行 #${a.index}: ${a.issues.join(', ')}`).join('\n') : '无明显异常'}

请按照以下结构输出 Markdown 格式的报告：
# ${aiTargetPlan} 性能诊断报告
## 1. 整体性能评估
## 2. 核心瓶颈分析（基于耗时最高的节点）
## 3. 稳定性分析（基于异常记录和最大/最小差值）
## 4. 优化建议
      `.trim();

      const response = await fetch(aiConfig.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: aiConfig.model,
          messages: [
            { role: 'user', content: promptText }
          ]
        }),
        signal: abortControllerRef.current.signal
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "API 请求失败");
      }

      const reportContent = data.choices[0].message.content;

      // 下载 Markdown 文件
      const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${aiTargetPlan}_性能诊断报告.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addAiLog(loggedInUsername, aiTargetPlan, '成功');

    } catch (error) {
      if (error.name === 'AbortError') {
        addAiLog(loggedInUsername, aiTargetPlan, '已取消');
      } else {
        addAiLog(loggedInUsername, aiTargetPlan, '失败');
        alert("生成报告失败：" + error.message + "\n\n如果是 API Key 错误或受限，请点击右侧配置按钮 ⚙️ 重新检查您的配置。");
        if (error.message.includes("401") || error.message.includes("key") || error.message.includes("Authentication") || error.message.includes("Insufficient Balance")) {
          setShowAISettings(true);
        }
      }
    } finally {
      setIsGeneratingAI(false);
      abortControllerRef.current = null;
    }
  };

  const handleLogout = () => {
    setLoggedInRole(null);
    setLoggedInUsername(null);
    localStorage.removeItem('LOGGED_IN_ROLE');
    localStorage.removeItem('LOGGED_IN_USERNAME');
    setShowDropdown(false);
    setAppState('login');
  };

  const handleUpdateMyPwd = () => {
    if (!myPwdForm.oldPwd || !myPwdForm.newPwd) {
      alert('原密码和新密码都不能为空');
      return;
    }
    
    if (loggedInRole === 'admin') {
      if (myPwdForm.oldPwd !== decodePwd(accounts.admin.passwordEncoded)) {
        alert('原密码不正确');
        return;
      }
      const newAccounts = {
        ...accounts,
        admin: { ...accounts.admin, passwordEncoded: encodePwd(myPwdForm.newPwd) }
      };
      setAccounts(newAccounts);
      localStorage.setItem('APP_ACCOUNTS', JSON.stringify(newAccounts));
      alert('密码修改成功！');
      setShowPwdModal(false);
      setMyPwdForm({ oldPwd: '', newPwd: '' });
    } else {
      const userIndex = accounts.users.findIndex(u => u.username === loggedInUsername);
      if (userIndex === -1) return alert('用户不存在');
      if (myPwdForm.oldPwd !== decodePwd(accounts.users[userIndex].passwordEncoded)) {
        alert('原密码不正确');
        return;
      }
      const newUsers = [...accounts.users];
      newUsers[userIndex].passwordEncoded = encodePwd(myPwdForm.newPwd);
      const newAccounts = { ...accounts, users: newUsers };
      setAccounts(newAccounts);
      localStorage.setItem('APP_ACCOUNTS', JSON.stringify(newAccounts));
      alert('密码修改成功！');
      setShowPwdModal(false);
      setMyPwdForm({ oldPwd: '', newPwd: '' });
    }
  };

  /* ================= 页面阶段 1：启动动画 (Splash) + 登录页面 (Login) 融合 ================= */
  if (appState === "splash" || appState === "login") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-900 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-slate-900 pointer-events-none"></div>
        
        {/* 外层容器：移除 gap-6 和 layout，通过右侧卡片的 marginLeft 来平滑撑开间距 */}
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-center w-full max-w-5xl px-4">
          
          {/* 左侧：Logo 展示区卡片 (始终保持透明无边框，只做平移) */}
          <motion.div 
            className="flex flex-col items-center justify-center relative p-12 z-20 flex-shrink-0"
            initial={{ width: '500px' }}
            animate={
              appState !== "splash" 
                ? { width: '420px' } 
                : { width: '500px' }
            }
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03]"></div>
            
            <motion.div 
              className="w-28 h-28 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-[2rem] shadow-[0_0_60px_rgba(37,99,235,0.6)] flex items-center justify-center mb-8 relative overflow-hidden z-10 border border-white/20"
              initial={{ scale: 0.8, opacity: 0, filter: "blur(10px)" }}
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              {appState === "splash" && (
                <motion.div 
                  initial={{ y: "-100%" }} animate={{ y: "100%" }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="absolute inset-0 w-full h-[20%] bg-gradient-to-b from-transparent via-white/30 to-transparent"
                />
              )}
              <svg className="w-16 h-16 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v2m0 4V6m0 0a2 2 0 100-4 2 2 0 000 4z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 11h1M21 11h1"></path>
                <line x1="8" y1="13" x2="8.01" y2="13" strokeWidth="3" strokeLinecap="round"></line>
                <line x1="16" y1="13" x2="16.01" y2="13" strokeWidth="3" strokeLinecap="round"></line>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17h6"></path>
              </svg>
            </motion.div>

            <motion.h1 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="text-4xl md:text-5xl font-black tracking-tight text-white relative z-10 text-center"
            >
              RCA.log
            </motion.h1>
            
            <motion.h2 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-xl font-semibold text-blue-400 mt-2 mb-4 tracking-widest uppercase relative z-10 text-center"
            >
              {appState !== "splash" ? "Analyzer" : "SYSTEM INITIALIZING..."}
            </motion.h2>

            {/* Splash 进度条：只在纯 splash 且没开始切换时显示 */}
            {appState === "splash" && (
              <motion.div 
                initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ delay: 0.8, duration: 1, ease: "easeInOut" }}
                className="h-1 w-full max-w-[260px] bg-blue-500 mt-6 rounded-full"
              />
            )}

            {/* 登录界面的副标题：切换时渐显 */}
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={appState !== "splash" ? { opacity: 1, height: 'auto', marginTop: '8px' } : {}}
              className="text-slate-400 text-sm text-center max-w-[260px] leading-relaxed relative z-10 overflow-hidden"
            >
              机器人控制系统日志深度分析与 AI 智能诊断平台
            </motion.p>
          </motion.div>

          {/* 右侧：独立登录卡片区 (同步渐入、滑出) */}
          <AnimatePresence>
            {appState === "login" && (
              <motion.div
                className="overflow-hidden flex-shrink-0 flex items-center z-10"
                initial={{ width: 0, opacity: 0, paddingLeft: 0 }}
                animate={{ width: 444, opacity: 1, paddingLeft: 24 }} // 420px content + 24px gap = 444px
                exit={{ width: 0, opacity: 0, paddingLeft: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="w-[420px] h-[540px] flex-shrink-0 flex flex-col justify-center bg-white/5 backdrop-blur-xl rounded-[2rem] border border-white/10 shadow-2xl p-10 relative">
                  <div className="w-full flex-1 flex flex-col justify-center">
                    <h3 className="text-2xl font-bold text-white mb-2">{isRegisterMode ? "账号注册" : "系统登录"}</h3>
              <p className="text-slate-400 text-sm mb-8">{isRegisterMode ? "创建一个新普通用户账号" : "请输入您的系统账号继续"}</p>
              
              <div className="space-y-5">
                <div className="relative">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">用户名</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={isRegisterMode ? registerForm.username : loginForm.username}
                      onChange={e => isRegisterMode ? setRegisterForm({...registerForm, username: e.target.value}) : setLoginForm({...loginForm, username: e.target.value})}
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl pl-4 pr-10 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      onKeyDown={e => e.key === 'Enter' && (isRegisterMode ? handleRegisterSubmit() : handleLoginSubmit())}
                    />
                    {!isRegisterMode && loginHistory.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 focus:outline-none"
                      >
                        <svg className={`w-5 h-5 transition-transform ${showHistoryDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                      </button>
                    )}
                  </div>

                  <AnimatePresence>
                    {showHistoryDropdown && !isRegisterMode && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        exit={{ opacity: 0, y: -10 }} 
                        className="absolute z-50 w-full mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto custom-scrollbar"
                      >
                        {loginHistory.map(historyUser => (
                          <div
                            key={historyUser}
                            className="px-4 py-3 text-slate-300 hover:bg-blue-600 hover:text-white cursor-pointer transition-colors text-sm border-b border-slate-700/50 last:border-0 flex items-center gap-2"
                            onClick={() => {
                              setLoginForm({ username: historyUser, password: '' });
                              setShowHistoryDropdown(false);
                            }}
                          >
                            <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                            {historyUser}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">密码</label>
                  <input 
                    type="password" 
                    value={isRegisterMode ? registerForm.password : loginForm.password}
                    onChange={e => isRegisterMode ? setRegisterForm({...registerForm, password: e.target.value}) : setLoginForm({...loginForm, password: e.target.value})}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    onKeyDown={e => e.key === 'Enter' && (isRegisterMode ? handleRegisterSubmit() : handleLoginSubmit())}
                  />
                </div>

                <AnimatePresence>
                  {isRegisterMode && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 mt-5">确认密码</label>
                      <input 
                        type="password" 
                        value={registerForm.confirmPassword}
                        onChange={e => setRegisterForm({...registerForm, confirmPassword: e.target.value})}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                        placeholder="再次输入密码"
                        onKeyDown={e => e.key === 'Enter' && handleRegisterSubmit()}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <AnimatePresence>
                  {loginError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="text-red-400 text-sm font-medium flex items-center gap-2 pt-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      {loginError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button 
                  onClick={isRegisterMode ? handleRegisterSubmit : handleLoginSubmit}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-900/20 transition-all mt-2"
                >
                  {isRegisterMode ? "注册并登录" : "登录系统"}
                </button>
                
                <div className="text-center mt-4">
                  <button 
                    onClick={() => {
                      setIsRegisterMode(!isRegisterMode);
                      setLoginError('');
                      setLoginForm({ username: '', password: '' });
                      setRegisterForm({ username: '', password: '', confirmPassword: '' });
                    }}
                    className="text-slate-400 hover:text-blue-400 text-sm font-medium transition-colors"
                  >
                    {isRegisterMode ? "已有账号？返回登录" : "没有账号？立即注册"}
                  </button>
                </div>
              </div>
            </div>
            </div>
          </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
  }
  /* ================= 页面阶段 2：欢迎与本地导入 (Welcome) ================= */
  if (appState === "welcome") {
    return (
      <>
        <div className="h-screen w-full flex items-center justify-center bg-[#f8fafc] p-6 relative overflow-hidden">
          {/* 动态光晕背景装饰 */}
          <div className="absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] bg-blue-400/20 rounded-full blur-[100px] pointer-events-none"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40rem] h-[40rem] bg-purple-400/20 rounded-full blur-[100px] pointer-events-none"></div>
          
          {/* 右上角头像与下拉菜单 */}
          <div className="absolute top-6 right-6 z-50">
            <div className="relative">
              <button 
                onClick={() => setShowDropdown(!showDropdown)} 
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white text-blue-600 font-bold border border-slate-200 shadow-sm hover:shadow-md hover:ring-2 hover:ring-blue-400 transition-all focus:outline-none"
              >
                {loggedInUsername?.charAt(0).toUpperCase() || 'U'}
              </button>

              <AnimatePresence>
                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)}></div>
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-12 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 z-[9999] overflow-hidden flex flex-col py-1"
                    >
                      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                        <div className="font-bold text-slate-800">{loggedInUsername}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{loggedInRole === 'admin' ? '系统管理员' : '普通用户'}</div>
                      </div>

                      <button onClick={() => {setShowDropdown(false); setShowPwdModal(true);}} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors w-full text-left">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                        修改密码
                      </button>

                      {loggedInRole === 'admin' && (
                        <button onClick={() => {setShowDropdown(false); setShowAISettings(true);}} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors w-full text-left">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                          系统设置
                        </button>
                      )}

                      <div className="border-t border-slate-100 my-1"></div>
                      
                      <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full text-left">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                        退出登录
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="max-w-md w-full bg-white/80 backdrop-blur-2xl rounded-[2rem] p-10 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.1)] border border-white text-center relative z-10"
          >
            <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-blue-100">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <h2 className="text-2xl font-extrabold text-slate-800 mb-3 tracking-tight">导入日志文件</h2>
            <p className="text-slate-500 text-sm mb-8 leading-relaxed">
              请上传包含 Plan 和节点执行时间的 .log 文件，系统将自动进行循环拆解与性能分析。
            </p>
            
            <label className="relative block group cursor-pointer">
                <div className="absolute inset-0 bg-blue-500 rounded-xl blur opacity-25 group-hover:opacity-40 transition-opacity duration-300"></div>
                <div className="relative bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-4 px-8 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                  选择文件并开始分析
                </div>
                <input type="file" accept=".log" multiple onChange={handleFile} className="hidden" />
              </label>
          </motion.div>
        </div>

        {/* ================= 全局模态框：脱离 dashboard 的限制，保证能在 welcome 页面上显示 ================= */}
        {/* 修改密码模态框 (自己修改自己) */}
        {showPwdModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-slate-100 relative">
              <button onClick={() => setShowPwdModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <h3 className="text-lg font-bold text-slate-800">修改密码</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">原密码</label>
                  <input 
                    type="password" 
                    value={myPwdForm.oldPwd}
                    onChange={e => setMyPwdForm({...myPwdForm, oldPwd: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">新密码</label>
                  <input 
                    type="password" 
                    value={myPwdForm.newPwd}
                    onChange={e => setMyPwdForm({...myPwdForm, newPwd: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                  />
                </div>
                <button 
                  onClick={handleUpdateMyPwd}
                  className="w-full mt-2 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                >
                  确认修改
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 系统设置模态框 (仅管理员) */}
        {showAISettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 border border-slate-100 flex flex-col md:flex-row gap-6">
              
              {/* 左侧：AI 模型配置 */}
              <div className="flex-1 space-y-4 pr-6 border-r border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg">⚙️</span> AI 模型配置
                  </h3>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">API Base URL</label>
                  <input 
                    type="text" 
                    value={aiConfig.baseUrl} 
                    onChange={e => setAiConfig({...aiConfig, baseUrl: e.target.value})} 
                    placeholder="https://api.moonshot.cn/v1/chat/completions"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">模型名称 (Model)</label>
                  <input 
                    type="text" 
                    value={aiConfig.model} 
                    onChange={e => setAiConfig({...aiConfig, model: e.target.value})} 
                    placeholder="moonshot-v1-8k"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">API Key</label>
                  <input 
                    type="password" 
                    value={aiConfig.apiKey} 
                    onChange={e => setAiConfig({...aiConfig, apiKey: e.target.value})} 
                    placeholder="sk-..." 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                  />
                </div>
                <div className="pt-2">
                  <button 
                    onClick={checkAIBalance}
                    className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold text-xs rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    查询余额 (DeepSeek/Kimi)
                  </button>
                  {balanceInfo && <span className="ml-3 text-xs font-mono text-slate-500">{balanceInfo}</span>}
                </div>
              </div>

              {/* 右侧：多页签面板 */}
              <div className="flex-1 flex flex-col min-h-[400px] h-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setAdminTab('users')}
                      className={`px-3 py-1.5 text-sm font-bold rounded-md transition-colors ${adminTab === 'users' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      👤 账号管理
                    </button>
                    <button 
                      onClick={() => setAdminTab('logs')}
                      className={`px-3 py-1.5 text-sm font-bold rounded-md transition-colors ${adminTab === 'logs' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      📋 AI 调用日志
                    </button>
                  </div>
                  <button onClick={() => setShowAISettings(false)} className="text-slate-400 hover:text-slate-600 transition-colors md:hidden">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  {adminTab === 'users' && (
                    <div className="space-y-4">
                      {/* 用户列表 */}
                      <div className="space-y-2">
                        {accounts.users.map((u, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-700">{u.username}</span>
                              <span className="text-xs font-mono text-slate-500">pwd: <span className="font-bold text-purple-600">{decodePwd(u.passwordEncoded)}</span></span>
                            </div>
                            <button 
                              onClick={() => handleDeleteUser(u.username)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="删除该用户"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 mt-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">添加新访问用户</h4>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={newUserForm.username}
                            onChange={e => setNewUserForm({...newUserForm, username: e.target.value})}
                            placeholder="新用户名"
                            className="w-1/2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" 
                          />
                          <input 
                            type="text" 
                            value={newUserForm.password}
                            onChange={e => setNewUserForm({...newUserForm, password: e.target.value})}
                            placeholder="密码"
                            className="w-1/2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" 
                          />
                        </div>
                        <button 
                          onClick={handleAddUser}
                          className="w-full py-2 bg-purple-600 text-white font-bold text-sm rounded-lg hover:bg-purple-700 transition-colors shadow-sm"
                        >
                          + 添加用户
                        </button>
                      </div>
                    </div>
                  )}

                  {adminTab === 'logs' && (
                    <div className="space-y-2">
                      {aiLogs.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 text-sm">暂无 AI 调用记录</div>
                      ) : (
                        aiLogs.map(log => (
                          <div key={log.id} className="p-3 bg-white border border-slate-200 rounded-lg flex flex-col gap-1 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                                <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-xs font-mono">{log.username}</span>
                              </span>
                              <span className="text-xs text-slate-400 font-mono">{log.time}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-slate-500 truncate max-w-[200px]" title={log.plan}>
                                请求分析: <span className="font-medium text-blue-600">{log.plan}</span>
                              </span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                log.status === '成功' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                log.status === '已取消' ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                                'bg-red-50 text-red-600 border border-red-100'
                              }`}>
                                {log.status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 底部按钮 (绝对定位或靠下) */}
              <div className="absolute top-6 right-6 hidden md:block">
                 <button onClick={() => setShowAISettings(false)} className="text-slate-400 hover:text-slate-600 transition-colors bg-slate-100 rounded-full p-1.5 hover:bg-slate-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
              
            </div>
            <div className="absolute bottom-10 flex gap-4">
                <button 
                  onClick={() => saveAiConfig(aiConfig)} 
                  className="px-8 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-1"
                >
                  保存所有配置并关闭
                </button>
            </div>
          </div>
        )}
      </>
    );
  }

  /* ================= 页面阶段 3：数据仪表盘 (Dashboard) ================= */
  return (
    <>
      <div className="h-screen w-full flex bg-[#f1f5f9] font-sans text-slate-800 overflow-hidden">
      
      {/* 左侧边栏 (Sidebar - 目录) */}
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.aside 
              initial={{ width: 0, opacity: 0, marginLeft: 0 }}
              animate={{ width: sidebarWidth, opacity: 1, marginLeft: 8 }}
              exit={{ width: 0, opacity: 0, marginLeft: 0 }}
              transition={{ duration: isResizing ? 0 : 0.2, ease: "easeInOut" }}
              className="bg-white border border-slate-200 rounded-2xl flex flex-col flex-shrink-0 z-20 shadow-sm overflow-hidden my-2"
            >
              <div className="px-4 py-4 border-b border-slate-100 flex justify-between items-center bg-white flex-shrink-0">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-bold text-slate-800 text-sm truncate">解析的 PLAN 列表</span>
                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0">{result ? Object.keys(result).length : 0}</span>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors flex-shrink-0 ml-2 bg-white shadow-sm"
                  title="折叠侧边栏"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                    <polyline points="15 16 11 12 15 8"></polyline>
                  </svg>
                </button>
              </div>
              
              <div className="px-4 py-3 border-b border-slate-100 bg-white flex-shrink-0">
                <div className="relative flex items-center">
                  <svg className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                  <input 
                    type="text" placeholder="搜索 Plan..." value={planFilter} onChange={e=>setPlanFilter(e.target.value)} 
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-sm placeholder:text-slate-300" 
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar bg-white">
                {!result ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="p-6 text-center text-sm text-slate-400 mt-10 bg-white rounded-xl border border-slate-200 border-dashed"
                  >
                    暂无数据，请先导入日志
                  </motion.div>
                ) : Object.keys(result).length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="p-6 text-center text-sm text-slate-400 mt-10 bg-white rounded-xl border border-slate-200 border-dashed flex flex-col items-center gap-3"
                  >
                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    <span>没有找到符合筛选条件的 Plan</span>
                  </motion.div>
                ) : (
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{
                      hidden: { opacity: 0 },
                      visible: {
                        opacity: 1,
                        transition: { staggerChildren: 0.05 }
                      }
                    }}
                  >
                    {Object.keys(result).map((plan) => {
                const isActive = activePlan === plan;
                const data = result[plan];
                const hasError = data.anomalies.length > 0;
                
                return (
                  <button
                    key={plan}
                    onClick={() => setActivePlan(plan)}
                    className={`w-full mb-2 text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all duration-200 group ${
                      isActive 
                        ? "bg-blue-600 text-white shadow-md ring-1 ring-blue-600" 
                        : "bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm"
                    } border border-slate-200`}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <div className={`text-sm font-semibold truncate font-mono transition-colors ${isActive ? 'text-white' : 'text-slate-600 group-hover:text-slate-800'}`} title={plan}>
                        {plan}
                      </div>
                      <div className={`text-[11px] mt-1 flex items-center gap-2 ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>
                        <span className="flex items-center gap-1"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> {data.avg.toFixed(3)}s</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${isActive ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'}`}>
                        {data.count} 次
                      </span>
                      {hasError && <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : 'bg-red-400'}`}></span>}
                    </div>
                  </button>
                );
              })}
            </motion.div>
            )}
          </div>
        </motion.aside>
      )}
      </AnimatePresence>

      {/* 拖拽分割线 (Resizer) */}
      {isSidebarOpen && (
        <div 
          onMouseDown={startResizing}
          className={`w-1.5 my-2 rounded-full flex-shrink-0 cursor-col-resize z-30 transition-colors flex items-center justify-center mx-0.5 ${isResizing ? 'bg-blue-100' : 'bg-transparent hover:bg-slate-200'}`}
          title="拖动调整宽度"
        >
          <div className={`w-0.5 h-8 rounded-full ${isResizing ? 'bg-blue-400' : 'bg-slate-300'}`}></div>
        </div>
      )}

      {/* 右侧主内容区 (Main Workspace) */}
      <main className="flex-1 flex flex-col overflow-y-auto py-2 pr-2 space-y-4">
        
        {/* 顶部 Header & Filter 组合控制区 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-shrink-0">
          {/* 上半部：标题与导入按钮 */}
          <div className="p-4 md:px-6 md:py-4 border-b border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white relative z-20">
            <div className="flex items-center gap-4">
              {!isSidebarOpen && (
                <button 
                  onClick={() => setIsSidebarOpen(true)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex-shrink-0"
                  title="展开侧边栏"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                  </svg>
                </button>
              )}
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              </div>
              <div className="flex flex-row items-center gap-4">
                <h1 className="text-lg font-extrabold tracking-tight text-slate-900 leading-tight whitespace-nowrap">RCA.log Analyzer</h1>
                <div 
                  className="grid grid-flow-col gap-x-3 gap-y-1.5 auto-cols-max items-center"
                  style={{ gridTemplateRows: `repeat(${Math.min(fileMeta?.files?.length || 1, 5)}, min-content)` }}
                >
                  {!fileMeta ? (
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">未导入文件</span>
                  ) : fileMeta.isMultiple ? (
                    fileMeta.files.map((f, i) => (
                      <span key={i} className="text-[10px] font-mono text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded uppercase tracking-wider w-fit">
                        {f.name} · {(f.size/1024).toFixed(1)} KB
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded uppercase tracking-wider w-fit">
                      {fileMeta.files[0].name} · {(fileMeta.totalSize/1024).toFixed(1)} KB
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 self-end md:self-auto relative">
              <button 
                onClick={() => setShowDropdown(!showDropdown)} 
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 text-blue-600 font-bold border border-blue-100 shadow-sm hover:bg-blue-100 transition-all focus:outline-none"
              >
                {loggedInUsername?.charAt(0).toUpperCase() || 'U'}
              </button>

              <AnimatePresence>
                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)}></div>
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-12 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 z-[9999] overflow-hidden flex flex-col py-1"
                    >
                      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                        <div className="font-bold text-slate-800">{loggedInUsername}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{loggedInRole === 'admin' ? '系统管理员' : '普通用户'}</div>
                      </div>
                      
                      <label className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 cursor-pointer transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> 
                        导入日志
                        <input type="file" accept=".log" multiple onChange={(e) => {setShowDropdown(false); handleFile(e);}} className="hidden" />
                      </label>

                      <button onClick={() => {setShowDropdown(false); setShowPwdModal(true);}} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors w-full text-left">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                        修改密码
                      </button>

                      {loggedInRole === 'admin' && (
                        <button onClick={() => {setShowDropdown(false); setShowAISettings(true);}} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors w-full text-left">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                          系统设置
                        </button>
                      )}

                      <div className="border-t border-slate-100 my-1"></div>
                      
                      <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full text-left">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                        退出登录
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* 下半部：时间筛选器 */}
          <div className="p-3 md:px-6 md:py-3 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <span className="text-sm font-bold text-slate-600">时间筛选</span>
              <ConfigProvider locale={locale} theme={{ token: { colorPrimary: '#3b82f6', borderRadius: 6 } }}>
                <RangePicker 
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  allowEmpty={[true, true]}
                  onChange={(dates) => {
                    if (dates) {
                      setStartTime(dates[0] || null);
                      setEndTime(dates[1] || null);
                    } else {
                      setStartTime(null);
                      setEndTime(null);
                    }
                  }}
                  value={[startTime, endTime]}
                  className="h-[36px] w-[320px] bg-white border-slate-200 hover:border-blue-400 focus:border-blue-500 shadow-sm"
                />
              </ConfigProvider>
              <button className="px-5 py-2 h-[36px] bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-all shadow-md active:scale-95 flex items-center justify-center" onClick={applyFilter}>
                应用筛选
              </button>

              <AnimatePresence initial={false}>
                {filterNotice && (
                  <motion.div
                    key="filter-notice"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-bold flex items-center gap-2"
                  >
                    <span className="text-red-500">⚠️</span> {filterNotice}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            {/* AI 分析控制区 */}
            {result && Object.keys(result).length > 0 && (
              <div className="flex items-center gap-2 self-end md:self-auto">
                <Select
                  value={aiTargetPlan}
                  onChange={setAiTargetPlan}
                  options={Object.keys(result).map(plan => ({ value: plan, label: plan }))}
                  className="w-[200px]"
                  placeholder="选择分析的 Plan"
                  size="large"
                />
                <button 
                  onClick={isGeneratingAI ? cancelAIGeneration : triggerGenerateAI}
                  className={`h-[40px] px-4 rounded-lg font-bold text-sm flex items-center gap-2 transition-all shadow-sm ${
                    isGeneratingAI 
                      ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:shadow-md hover:-translate-y-0.5' 
                      : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:shadow-md hover:-translate-y-0.5'
                  }`}
                >
                  {isGeneratingAI ? (
                    <><svg className="animate-spin h-4 w-4 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 停止分析</>
                  ) : (
                    <>✨ 生成 AI 诊断报告</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Content */}
        {!activeData ? (
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400">
            <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <p className="text-lg font-medium">请从左侧选择一个 Plan 以查看详情</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div 
              key={activePlan} 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* Stats Card (Big black numbers) */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col gap-6">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                  <span className="w-1.5 h-6 bg-blue-500 rounded-full inline-block"></span>
                  选择 {activePlan} 以分析
                </h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500 tracking-wider">执行总次数</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-black text-slate-800 tabular-nums">{activeData.count}</span>
                      <span className="text-sm font-bold text-slate-400">次</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500 tracking-wider">平均节拍</span>
                    <span className="text-4xl font-black text-slate-800 tabular-nums">{activeData.avg.toFixed(3)}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500 tracking-wider">最大耗时</span>
                    <span className="text-4xl font-black text-slate-800 tabular-nums">{activeData.max.toFixed(3)}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-bold text-slate-500 tracking-wider">最小耗时</span>
                    <span className="text-4xl font-black text-slate-800 tabular-nums">{activeData.min.toFixed(3)}</span>
                  </div>
                </div>
              </div>

              {/* 异常报告 */}
              {activeData.anomalies.length > 0 && (
                <div className="bg-red-50/80 rounded-2xl border border-red-100 p-5 shadow-sm">
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
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* 趋势图 */}
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
                  className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"
                >
                  <h3 className="mb-4 text-slate-700 font-bold flex items-center gap-2 text-sm">
                    <span className="bg-slate-100 text-slate-500 p-1.5 rounded-lg">📈</span> 信号时间序列趋势
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trendData[activePlan]} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                      <XAxis dataKey="index" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)'}}
                        itemStyle={{color: '#0f172a', fontWeight: 600}}
                      />
                      <Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={2.5} dot={{fill: '#3b82f6', strokeWidth: 2, r: 3}} activeDot={{r: 5, strokeWidth: 0, fill: '#2563eb'}} />
                    </LineChart>
                  </ResponsiveContainer>
                </motion.div>

                {/* 节点排行 */}
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
                  className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm"
                >
                  <h3 className="mb-4 text-slate-700 font-bold flex items-center gap-2 text-sm">
                    <span className="bg-slate-100 text-slate-500 p-1.5 rounded-lg">📊</span> 多信号均值对比 (Top)
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={activeData.nodes} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                      <XAxis dataKey="node" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} interval={0} tick={{width: 50}} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip 
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)'}}
                      />
                      <Bar dataKey="avg" radius={[4, 4, 0, 0]} maxBarSize={32}>
                        {activeData.nodes.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? "#f43f5e" : "#94a3b8"} className="transition-all duration-300 hover:opacity-80 cursor-pointer" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              </div>

              {/* 执行流与循环结构分析 */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between rounded-t-2xl">
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
                    const loopTotals = loopGroups.map(g => g.total).filter(t => Number.isFinite(t));
                    const loopAvg = loopTotals.length > 0 ? (loopTotals.reduce((a, b) => a + b, 0) / loopTotals.length) : null;
                    const loopMax = loopTotals.length > 0 ? Math.max(...loopTotals) : null;
                    const loopMin = loopTotals.length > 0 ? Math.min(...loopTotals) : null;
                    const isExpanded = !!expandedRuns[i];
                    
                    return (
                      <div key={i} className="bg-slate-50 rounded-xl border border-slate-200">
                        {/* Run Header (Sticky & Clickable) */}
                        <div 
                          onClick={() => toggleRun(i)}
                          className={`flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur-md cursor-pointer hover:bg-blue-50/50 transition-colors sticky top-0 z-10 ${
                            isExpanded ? "border-b border-slate-200 rounded-t-xl shadow-sm" : "rounded-xl hover:shadow-sm"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="bg-slate-800 text-white w-6 h-6 rounded flex items-center justify-center text-xs font-bold shadow-sm">{i+1}</span>
                            <span className="text-sm font-bold text-slate-700">运行记录 #{i+1}</span>
                            {hasLoops && (
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold tracking-wide">
                                发现 {loopGroups.length} 个循环体
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                              <span className="bg-slate-50 border border-slate-200 rounded px-2 py-1 tabular-nums">
                                循环均值: {loopAvg === null ? "-" : `${loopAvg.toFixed(3)}s`}
                              </span>
                              <span className="bg-slate-50 border border-slate-200 rounded px-2 py-1 tabular-nums">
                                最大: {loopMax === null ? "-" : `${loopMax.toFixed(3)}s`}
                              </span>
                              <span className="bg-slate-50 border border-slate-200 rounded px-2 py-1 tabular-nums">
                                最小: {loopMin === null ? "-" : `${loopMin.toFixed(3)}s`}
                              </span>
                            </div>
                            <div className="text-sm font-bold text-slate-800 tabular-nums bg-slate-100 px-3 py-1 rounded-md">
                              总耗时: {totalTime.toFixed(3)}s
                            </div>
                            <svg 
                              className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} 
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                            </svg>
                          </div>
                        </div>
                        
                        {/* 阶段列表 (可折叠) */}
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="p-3 flex flex-col gap-2">
                                {run.groups?.map((g, gi) => {
                                  const config = GROUP_CONFIG[g.type] || GROUP_CONFIG.all;
                                  const pct = totalTime > 0 ? (g.total / totalTime) * 100 : 0;
                                  
                                  return (
                                    <div key={gi} className={`rounded-lg border ${config.borderColor} ${config.gradient} overflow-hidden shadow-sm transition-all hover:shadow-md`}>
                                      <div className="flex items-center justify-between px-3 py-2 border-b border-white/40">
                                        <div className="flex items-center gap-2">
                                          <span className={`w-6 h-6 rounded flex items-center justify-center text-sm ${config.lightColor} shadow-sm`}>
                                            {config.icon}
                                          </span>
                                          <span className={`font-bold text-sm ${config.textColor}`}>
                                            {config.label} {g.type === 'loop' && <span className="ml-1 text-xs opacity-75">Trigger: {g.nodes[0]?.name}</span>}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                          <div className="flex items-center gap-2 w-32 justify-end">
                                            <div className="h-1.5 w-16 bg-slate-200 rounded-full overflow-hidden">
                                              <div className={`h-full ${config.badgeColor} rounded-full`} style={{ width: `${pct}%` }}></div>
                                            </div>
                                            <span className="text-[10px] text-slate-500 font-medium w-10 text-right">{pct.toFixed(1)}% 占比</span>
                                          </div>
                                          <span className={`font-black tabular-nums bg-white px-2 py-0.5 rounded shadow-sm ${config.textColor}`}>
                                            {g.total.toFixed(3)}s
                                          </span>
                                        </div>
                                      </div>
                                      <div className="px-3 py-2 flex flex-wrap gap-1.5">
                                        {g.nodes.map((n, ni) => (
                                          <div key={ni} className="flex items-center bg-white border border-slate-100 rounded shadow-sm hover:shadow transition-shadow">
                                            <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5">{n.name}</span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 bg-slate-50 ${config.textColor}`}>{n.time.toFixed(3)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
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

      {/* 修改密码模态框 (自己修改自己) */}
      {showPwdModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-slate-100 relative">
            <button onClick={() => setShowPwdModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800">修改密码</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">原密码</label>
                <input 
                  type="password" 
                  value={myPwdForm.oldPwd}
                  onChange={e => setMyPwdForm({...myPwdForm, oldPwd: e.target.value})}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">新密码</label>
                <input 
                  type="password" 
                  value={myPwdForm.newPwd}
                  onChange={e => setMyPwdForm({...myPwdForm, newPwd: e.target.value})}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                />
              </div>
              <button 
                onClick={handleUpdateMyPwd}
                className="w-full mt-2 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 系统设置模态框 (仅管理员) */}
      {showAISettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 border border-slate-100 flex flex-col md:flex-row gap-6">
            
            {/* 左侧：AI 模型配置 */}
            <div className="flex-1 space-y-4 pr-6 border-r border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg">⚙️</span> AI 模型配置
                </h3>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">API Base URL</label>
                <input 
                  type="text" 
                  value={aiConfig.baseUrl} 
                  onChange={e => setAiConfig({...aiConfig, baseUrl: e.target.value})} 
                  placeholder="https://api.moonshot.cn/v1/chat/completions"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">模型名称 (Model)</label>
                <input 
                  type="text" 
                  value={aiConfig.model} 
                  onChange={e => setAiConfig({...aiConfig, model: e.target.value})} 
                  placeholder="moonshot-v1-8k"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">API Key</label>
                <input 
                  type="password" 
                  value={aiConfig.apiKey} 
                  onChange={e => setAiConfig({...aiConfig, apiKey: e.target.value})} 
                  placeholder="sk-..." 
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all" 
                />
              </div>
              <div className="pt-2">
                <button 
                  onClick={checkAIBalance}
                  className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold text-xs rounded-lg hover:bg-indigo-100 transition-colors"
                >
                  查询余额 (DeepSeek/Kimi)
                </button>
                {balanceInfo && <span className="ml-3 text-xs font-mono text-slate-500">{balanceInfo}</span>}
              </div>
            </div>

            {/* 右侧：多页签面板 */}
            <div className="flex-1 flex flex-col min-h-[400px] h-full overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                  <button 
                    onClick={() => setAdminTab('users')}
                    className={`px-3 py-1.5 text-sm font-bold rounded-md transition-colors ${adminTab === 'users' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    👤 账号管理
                  </button>
                  <button 
                    onClick={() => setAdminTab('logs')}
                    className={`px-3 py-1.5 text-sm font-bold rounded-md transition-colors ${adminTab === 'logs' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    📋 AI 调用日志
                  </button>
                </div>
                <button onClick={() => setShowAISettings(false)} className="text-slate-400 hover:text-slate-600 transition-colors md:hidden">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {adminTab === 'users' && (
                  <div className="space-y-4">
                    {/* 用户列表 */}
                    <div className="space-y-2">
                      {accounts.users.map((u, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-700">{u.username}</span>
                            <span className="text-xs font-mono text-slate-500">pwd: <span className="font-bold text-purple-600">{decodePwd(u.passwordEncoded)}</span></span>
                          </div>
                          <button 
                            onClick={() => handleDeleteUser(u.username)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="删除该用户"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 mt-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">添加新访问用户</h4>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={newUserForm.username}
                          onChange={e => setNewUserForm({...newUserForm, username: e.target.value})}
                          placeholder="新用户名"
                          className="w-1/2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" 
                        />
                        <input 
                          type="text" 
                          value={newUserForm.password}
                          onChange={e => setNewUserForm({...newUserForm, password: e.target.value})}
                          placeholder="密码"
                          className="w-1/2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" 
                        />
                      </div>
                      <button 
                        onClick={handleAddUser}
                        className="w-full py-2 bg-purple-600 text-white font-bold text-sm rounded-lg hover:bg-purple-700 transition-colors shadow-sm"
                      >
                        + 添加用户
                      </button>
                    </div>
                  </div>
                )}

                {adminTab === 'logs' && (
                  <div className="space-y-2">
                    {aiLogs.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 text-sm">暂无 AI 调用记录</div>
                    ) : (
                      aiLogs.map(log => (
                        <div key={log.id} className="p-3 bg-white border border-slate-200 rounded-lg flex flex-col gap-1 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-700 flex items-center gap-1.5">
                              <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-xs font-mono">{log.username}</span>
                            </span>
                            <span className="text-xs text-slate-400 font-mono">{log.time}</span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-slate-500 truncate max-w-[200px]" title={log.plan}>
                              请求分析: <span className="font-medium text-blue-600">{log.plan}</span>
                            </span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                              log.status === '成功' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                              log.status === '已取消' ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                              'bg-red-50 text-red-600 border border-red-100'
                            }`}>
                              {log.status}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 底部按钮 (绝对定位或靠下) */}
            <div className="absolute top-6 right-6 hidden md:block">
               <button onClick={() => setShowAISettings(false)} className="text-slate-400 hover:text-slate-600 transition-colors bg-slate-100 rounded-full p-1.5 hover:bg-slate-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          </div>
          <div className="absolute bottom-10 flex gap-4">
              <button 
                onClick={() => saveAiConfig(aiConfig)} 
                className="px-8 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-1"
              >
                保存所有配置并关闭
              </button>
          </div>
        </div>
      )}
    </>
  );
}
