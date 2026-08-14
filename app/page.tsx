'use client';

import { useState, useEffect } from 'react';
import {
  Activity,
  Server,
  Cpu,
  HardDrive,
  Globe,
  Users,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  Clock,
  RefreshCw,
  Bell,
  Settings,
  Search,
  DollarSign
} from 'lucide-react';

interface AppStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: string;
  requests: number;
  errors: number;
  latency: number;
  version: string;
}

interface SystemMetric {
  label: string;
  value: number;
  unit: string;
  max: number;
  status: 'good' | 'warning' | 'critical';
}

interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  app: string;
  time: string;
}

export default function OpsCenter() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const apps: AppStatus[] = [
    { name: 'Javari AI', status: 'healthy', uptime: '99.97%', requests: 45230, errors: 12, latency: 142, version: '2.1.4' },
    { name: 'Market Oracle', status: 'healthy', uptime: '99.91%', requests: 28450, errors: 8, latency: 89, version: '1.8.2' },
    { name: 'PDF Builder Pro', status: 'healthy', uptime: '99.99%', requests: 12840, errors: 2, latency: 234, version: '1.2.0' },
    { name: 'Social Graphics', status: 'degraded', uptime: '98.45%', requests: 8920, errors: 45, latency: 456, version: '1.1.1' },
    { name: 'Invoice Generator', status: 'healthy', uptime: '99.95%', requests: 6230, errors: 4, latency: 178, version: '1.0.3' },
    { name: 'Admin Dashboard', status: 'healthy', uptime: '100%', requests: 1240, errors: 0, latency: 67, version: '1.0.0' },
    { name: 'Javari Spirits', status: 'healthy', uptime: '99.88%', requests: 4560, errors: 6, latency: 145, version: '1.3.1' },
    { name: 'CardVerse', status: 'down', uptime: '94.20%', requests: 0, errors: 156, latency: 0, version: '0.9.2' },
  ];

  const systemMetrics: SystemMetric[] = [
    { label: 'CPU Usage', value: 34, unit: '%', max: 100, status: 'good' },
    { label: 'Memory', value: 62, unit: '%', max: 100, status: 'good' },
    { label: 'Bandwidth', value: 2.4, unit: 'TB', max: 10, status: 'good' },
    { label: 'Storage', value: 78, unit: '%', max: 100, status: 'warning' },
  ];

  const alerts: Alert[] = [
    { id: '1', severity: 'critical', message: 'CardVerse deployment failed - build error', app: 'CardVerse', time: '2 min ago' },
    { id: '2', severity: 'warning', message: 'High latency detected (>400ms)', app: 'Social Graphics', time: '15 min ago' },
    { id: '3', severity: 'info', message: 'Auto-scaling triggered - 2 new instances', app: 'Javari AI', time: '32 min ago' },
    { id: '4', severity: 'warning', message: 'Storage approaching 80% capacity', app: 'System', time: '1 hr ago' },
  ];

  const totalRequests = apps.reduce((sum, app) => sum + app.requests, 0);
  const totalErrors = apps.reduce((sum, app) => sum + app.errors, 0);
  const healthyApps = apps.filter(a => a.status === 'healthy').length;
  const avgLatency = Math.round(apps.filter(a => a.latency > 0).reduce((sum, a) => sum + a.latency, 0) / apps.filter(a => a.latency > 0).length);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="min-h-screen p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl">
              <Activity className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">AI Operations Command Center</h1>
              <p className="text-gray-400 text-sm">Javariverse Infrastructure Monitoring</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-gray-400">
            <Clock className="w-4 h-4" />
            <span className="font-mono">{currentTime.toLocaleTimeString()}</span>
          </div>
          <button
            onClick={handleRefresh}
            className={`p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs flex items-center justify-center">4</span>
          </button>
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <Server className="w-5 h-5 text-green-400" />
            <span className="text-green-400 text-sm">{healthyApps}/{apps.length}</span>
          </div>
          <div className="text-2xl font-bold mt-2">{healthyApps}</div>
          <div className="text-sm text-gray-400">Healthy Apps</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <Globe className="w-5 h-5 text-blue-400" />
            <TrendingUp className="w-4 h-4 text-green-400" />
          </div>
          <div className="text-2xl font-bold mt-2">{(totalRequests / 1000).toFixed(1)}K</div>
          <div className="text-sm text-gray-400">Requests (24h)</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <Zap className="w-5 h-5 text-yellow-400" />
            <span className="text-gray-400 text-sm">avg</span>
          </div>
          <div className="text-2xl font-bold mt-2">{avgLatency}ms</div>
          <div className="text-sm text-gray-400">Response Time</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-red-400 text-sm">{((totalErrors / totalRequests) * 100).toFixed(2)}%</span>
          </div>
          <div className="text-2xl font-bold mt-2">{totalErrors}</div>
          <div className="text-sm text-gray-400">Errors (24h)</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* App Status Panel */}
        <div className="lg:col-span-2 bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Server className="w-5 h-5 text-purple-400" />
              Application Status
            </h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search apps..."
                className="pl-9 pr-4 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 w-40"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
                  <th className="pb-3">Application</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Uptime</th>
                  <th className="pb-3">Requests</th>
                  <th className="pb-3">Latency</th>
                  <th className="pb-3">Version</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((app, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 font-medium">{app.name}</td>
                    <td className="py-3">
                      <span className={`flex items-center gap-1.5 ${
                        app.status === 'healthy' ? 'text-green-400' :
                        app.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {app.status === 'healthy' ? <CheckCircle className="w-4 h-4" /> :
                         app.status === 'degraded' ? <AlertTriangle className="w-4 h-4" /> :
                         <XCircle className="w-4 h-4" />}
                        {app.status}
                      </span>
                    </td>
                    <td className="py-3 text-gray-300">{app.uptime}</td>
                    <td className="py-3 text-gray-300">{app.requests.toLocaleString()}</td>
                    <td className="py-3">
                      <span className={app.latency > 300 ? 'text-yellow-400' : 'text-gray-300'}>
                        {app.latency > 0 ? `${app.latency}ms` : '-'}
                      </span>
                    </td>
                    <td className="py-3 text-gray-500 font-mono text-sm">{app.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* System Metrics */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-purple-400" />
              System Resources
            </h2>
            <div className="space-y-4">
              {systemMetrics.map((metric, idx) => (
                <div key={idx}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">{metric.label}</span>
                    <span className={
                      metric.status === 'critical' ? 'text-red-400' :
                      metric.status === 'warning' ? 'text-yellow-400' : 'text-green-400'
                    }>
                      {metric.value}{metric.unit}
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        metric.status === 'critical' ? 'bg-red-500' :
                        metric.status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${(metric.value / metric.max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-purple-400" />
              Recent Alerts
            </h2>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className={`p-3 rounded-lg border ${
                  alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                  alert.severity === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30' :
                  'bg-blue-500/10 border-blue-500/30'
                }`}>
                  <div className="flex items-start gap-2">
                    {alert.severity === 'critical' ? <XCircle className="w-4 h-4 text-red-400 mt-0.5" /> :
                     alert.severity === 'warning' ? <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5" /> :
                     <Activity className="w-4 h-4 text-blue-400 mt-0.5" />}
                    <div className="flex-1">
                      <div className="text-sm">{alert.message}</div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{alert.app}</span>
                        <span>{alert.time}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-gray-800 flex items-center justify-between text-sm text-gray-500">
        <div>CR AudioViz AI • Operations Command Center v1.0.0</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          All systems operational
        </div>
      </footer>
    </div>
  );
}
