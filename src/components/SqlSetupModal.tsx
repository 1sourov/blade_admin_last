import { useState } from 'react';
import { Check, Copy, Database, X } from 'lucide-react';
import { generateTailoredSqlMigration } from '../lib/sqlMigrationGenerator';
import type { SchemaInspectionResult } from '../types/blade';

interface SqlSetupModalProps {
  open: boolean;
  schema: SchemaInspectionResult | null;
  onClose: () => void;
  onRecheck?: () => void;
}

export function SqlSetupModal({ open, schema, onClose, onRecheck }: SqlSetupModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const sql = generateTailoredSqlMigration(schema);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-4xl bg-white border border-zinc-200 rounded-lg shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-zinc-200">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-md bg-zinc-950 text-white shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-950">
                Supabase Schema Compatibility Migration
              </h2>
              <p className="text-xs text-zinc-600 mt-1">
                Non-destructive SQL tailored to your existing Android tables. Run this once in your
                Supabase Dashboard → SQL Editor to enable admin authorization, RLS policies,
                storage metrics, and Realtime.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-950"
            aria-label="Close SQL migration modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {schema && schema.missingCapabilities.length > 0 && (
          <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-700">
            <span className="font-semibold text-zinc-950">Detected gaps: </span>
            {schema.missingCapabilities.join(' · ')}
          </div>
        )}

        <div className="p-4 flex-1 overflow-auto bg-zinc-950 text-zinc-100">
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
            {sql}
          </pre>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-zinc-50 border-t border-zinc-200">
          <p className="text-xs text-zinc-500">
            Reuses existing tables and uses <code className="font-mono">IF NOT EXISTS</code> so no
            production Android data is altered or dropped.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-zinc-950 text-white rounded-md hover:bg-zinc-800 transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied SQL' : 'Copy SQL Migration'}
            </button>
            {onRecheck && (
              <button
                type="button"
                onClick={onRecheck}
                className="px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors whitespace-nowrap"
              >
                Re-check Supabase Schema
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
