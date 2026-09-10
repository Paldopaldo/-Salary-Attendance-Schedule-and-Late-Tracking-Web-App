import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Play, RefreshCw, ShieldCheck, Filter } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';

interface TestCaseResult {
  name: string;
  category: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

interface TestSuiteSummary {
  total: number;
  passed: number;
  failed: number;
  results: TestCaseResult[];
}

export const TestRunnerView: React.FC = () => {
  const [suite, setSuite] = useState<TestSuiteSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  const runTests = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<TestSuiteSummary>('/tests/run');
      setSuite(data);
    } catch (err: any) {
      console.error('Failed to run test suite:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runTests();
  }, []);

  const categories = suite ? ['ALL', ...Array.from(new Set(suite.results.map((r) => r.category)))] : ['ALL'];

  const filteredResults = suite
    ? filterCategory === 'ALL'
      ? suite.results
      : suite.results.filter((r) => r.category === filterCategory)
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-neutral-900">Automated Test Suite Verification</h2>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
              Live Runner
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Executes unit and integration test assertions for daily ceilings, monthly limits, break deductions, boundary isolation, and concurrent race-condition locks.
          </p>
        </div>

        <button
          type="button"
          onClick={runTests}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 disabled:opacity-50 transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Running Suite...' : 'Re-Run All Tests'}</span>
        </button>
      </div>

      {/* Metrics Summary Cards */}
      {suite && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
            <span className="text-xs font-semibold uppercase text-neutral-500 block">Total Tests</span>
            <span className="text-3xl font-extrabold text-neutral-900">{suite.total}</span>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
            <span className="text-xs font-semibold uppercase text-emerald-700 block">Passed Tests</span>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="text-3xl font-extrabold text-emerald-900">{suite.passed}</span>
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
            <span className="text-xs font-semibold uppercase text-neutral-500 block">Failed Tests</span>
            <span className={`text-3xl font-extrabold ${suite.failed > 0 ? 'text-rose-600' : 'text-neutral-400'}`}>
              {suite.failed}
            </span>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilterCategory(cat)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filterCategory === cat
                ? 'bg-neutral-900 text-white'
                : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Test Results Table */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Status</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Test Assertion Description</th>
                <th className="px-4 py-3">Expected Outcome</th>
                <th className="px-4 py-3">Actual Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
              {filteredResults.map((t, idx) => (
                <tr key={idx} className="hover:bg-neutral-50/80 transition">
                  <td className="px-5 py-3">
                    {t.passed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-600/20">
                        <CheckCircle2 className="h-3 w-3" /> PASS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-600/20">
                        <XCircle className="h-3 w-3" /> FAIL
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-neutral-500">{t.category}</td>
                  <td className="px-4 py-3 font-semibold text-neutral-900">{t.name}</td>
                  <td className="px-4 py-3 text-neutral-600 font-mono text-[11px]">{t.expected}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-neutral-900">{t.actual}</td>
                </tr>
              ))}
              {filteredResults.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-neutral-400">
                    No tests in this category.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-neutral-400">
                    Executing test assertions...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
