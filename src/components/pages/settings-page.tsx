import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

interface SettingsPageProps {
  isAdmin: boolean
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void
}

type Theme = 'light' | 'dark' | 'system'

interface Settings {
  // User settings
  terminalFontSize: string
  theme: string
  debugMode: string
  scrollSensitivity: string
  // System settings (admin only)
  sessionTimeoutSeconds: string
  paneHistoryLines: string
  paneStreamIntervalMs: string
}

const DEFAULTS: Settings = {
  terminalFontSize: '14',
  theme: 'system',
  debugMode: 'false',
  scrollSensitivity: '5',
  sessionTimeoutSeconds: '28800',
  paneHistoryLines: '200',
  paneStreamIntervalMs: '1000',
}

export function SettingsPage({ isAdmin, onThemeChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState<Partial<Settings>>({})

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings({ ...DEFAULTS, ...data.settings })
      })
      .catch(() => toast.error('설정을 불러오지 못했습니다'))
      .finally(() => setLoading(false))
  }, [])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setDirty((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = useCallback(async () => {
    if (Object.keys(dirty).length === 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: dirty }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? '설정 저장에 실패했습니다')
        return
      }
      toast.success('설정이 저장되었습니다')
      setDirty({})
      // Sync theme with app
      if (dirty.theme) onThemeChange(dirty.theme as Theme)
    } catch {
      toast.error('네트워크 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }, [dirty, onThemeChange])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-6">
        <h1 className="text-lg font-semibold">설정</h1>
        <div className="ml-auto">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || Object.keys(dirty).length === 0}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            저장
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-2xl">

        {/* 터미널 설정 */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">터미널</h2>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>폰트 크기</Label>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {settings.terminalFontSize}px
                </span>
              </div>
              <Slider
                min={12}
                max={24}
                step={1}
                value={[Number(settings.terminalFontSize)]}
                onValueChange={([v]: number[]) => update('terminalFontSize', String(v))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>12px</span>
                <span>24px</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>스크롤 민감도</Label>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {settings.scrollSensitivity}
                </span>
              </div>
              <Slider
                min={1}
                max={10}
                step={1}
                value={[Number(settings.scrollSensitivity)]}
                onValueChange={([v]: number[]) => update('scrollSensitivity', String(v))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>낮음</span>
                <span>높음</span>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        {/* 외관 */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">외관</h2>
          <div className="space-y-2">
            <Label className="text-sm font-medium">테마</Label>
            <div className="flex gap-2 mt-2">
              {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update('theme', t)}
                  className={[
                    'flex-1 rounded-md border px-3 py-2 text-sm transition-colors',
                    settings.theme === t
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:bg-accent text-muted-foreground',
                  ].join(' ')}
                >
                  {t === 'light' ? '라이트' : t === 'dark' ? '다크' : '시스템'}
                </button>
              ))}
            </div>
          </div>
        </section>

        <Separator />

        {/* 개발자 옵션 */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">개발자 옵션</h2>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label htmlFor="debug-mode" className="text-sm font-medium">디버그 모드</Label>
              <p className="text-xs text-muted-foreground mt-0.5">개발용 디버그 정보를 표시합니다</p>
            </div>
            <Switch
              id="debug-mode"
              checked={settings.debugMode === 'true'}
              onCheckedChange={(checked) => update('debugMode', checked ? 'true' : 'false')}
            />
          </div>
        </section>

        {/* 시스템 설정 (admin only) */}
        {isAdmin && (
          <>
            <Separator />
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">시스템 설정</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="session-timeout">세션 타임아웃 (분)</Label>
                  <Input
                    id="session-timeout"
                    type="number"
                    min={1}
                    max={10080}
                    value={Math.round(Number(settings.sessionTimeoutSeconds) / 60)}
                    onChange={(e) => update('sessionTimeoutSeconds', String(Number(e.target.value) * 60))}
                    className="max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground">변경 사항은 다음 로그인부터 적용됩니다</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="history-lines">패널 히스토리 라인 수</Label>
                  <Input
                    id="history-lines"
                    type="number"
                    min={50}
                    max={5000}
                    value={settings.paneHistoryLines}
                    onChange={(e) => update('paneHistoryLines', e.target.value)}
                    className="max-w-xs"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stream-interval">PTY 스트림 인터벌 (ms)</Label>
                  <Input
                    id="stream-interval"
                    type="number"
                    min={100}
                    max={5000}
                    value={settings.paneStreamIntervalMs}
                    onChange={(e) => update('paneStreamIntervalMs', e.target.value)}
                    className="max-w-xs"
                  />
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
