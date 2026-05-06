import * as React from 'react'
import { useState } from 'react'
import { GitBranch, Loader2, ShieldAlert, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'

interface AccountUser {
  username: string
  displayName?: string
  email?: string
  avatarUrl?: string
  githubUsername?: string
}

interface AccountPageProps {
  user: AccountUser
  onLogout: () => void
  onProfileUpdate: (updates: { displayName?: string; email?: string }) => void
}

export function AccountPage({ user, onLogout, onProfileUpdate }: AccountPageProps) {
  // Profile state
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const [email, setEmail] = useState(user.email ?? '')
  const [profileSaving, setProfileSaving] = useState(false)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Delete state
  const [deleting, setDeleting] = useState(false)

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setProfileSaving(true)
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName || undefined,
          email: email || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? '프로필 저장에 실패했습니다')
        return
      }
      onProfileUpdate({ displayName: displayName || undefined, email: email || undefined })
      toast.success('프로필이 저장되었습니다')
    } catch {
      toast.error('네트워크 오류가 발생했습니다')
    } finally {
      setProfileSaving(false)
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword !== newPasswordConfirm) {
      setPasswordError('새 비밀번호가 일치하지 않습니다')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('비밀번호는 8자 이상이어야 합니다')
      return
    }
    setPasswordSaving(true)
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, newPasswordConfirm }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPasswordError((data as { error?: string }).error ?? '비밀번호 변경에 실패했습니다')
        return
      }
      toast.success('비밀번호가 변경되었습니다')
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordConfirm('')
    } catch {
      toast.error('네트워크 오류가 발생했습니다')
    } finally {
      setPasswordSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch('/api/users/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? '계정 삭제에 실패했습니다')
        return
      }
      onLogout()
    } catch {
      toast.error('네트워크 오류가 발생했습니다')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center border-b px-6">
        <h1 className="text-lg font-semibold">내 계정</h1>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-2xl">

        {/* 프로필 */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">프로필</h2>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username-display">사용자명</Label>
              <Input
                id="username-display"
                value={user.username}
                disabled
                className="bg-muted text-muted-foreground cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground">사용자명은 변경할 수 없습니다</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="display-name">표시 이름</Label>
              <Input
                id="display-name"
                placeholder="홍길동"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={128}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={256}
              />
            </div>

            <Button type="submit" disabled={profileSaving}>
              {profileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              프로필 저장
            </Button>
          </form>
        </section>

        <Separator />

        {/* 비밀번호 변경 */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">비밀번호 변경</h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {passwordError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {passwordError}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="current-password">현재 비밀번호</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showPasswords ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">새 비밀번호</Label>
              <Input
                id="new-password"
                type={showPasswords ? 'text' : 'password'}
                placeholder="8자 이상"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password-confirm">새 비밀번호 확인</Label>
              <Input
                id="new-password-confirm"
                type={showPasswords ? 'text' : 'password'}
                placeholder="새 비밀번호를 다시 입력하세요"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <Button type="submit" disabled={passwordSaving}>
              {passwordSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              비밀번호 변경
            </Button>
          </form>
        </section>

        <Separator />

        {/* GitHub 연결 */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">GitHub 연결</h2>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {user.githubUsername ? `@${user.githubUsername}` : 'GitHub 계정 미연결'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user.githubUsername
                    ? 'GitHub 계정이 연결되어 있습니다'
                    : 'GitHub 로그인은 추후 지원될 예정입니다'}
                </p>
              </div>
            </div>
            <Badge variant={user.githubUsername ? 'default' : 'secondary'}>
              {user.githubUsername ? '연결됨' : '미연결'}
            </Badge>
          </div>
        </section>

        <Separator />

        {/* 위험 영역 */}
        <section>
          <h2 className="text-sm font-semibold text-destructive uppercase tracking-wide mb-4 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            위험 영역
          </h2>
          <div className="rounded-lg border border-destructive/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">계정 삭제</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  계정과 모든 설정이 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleting}>
                    {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    계정 삭제
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>계정을 삭제하시겠습니까?</AlertDialogTitle>
                    <AlertDialogDescription>
                      이 작업은 되돌릴 수 없습니다. 계정과 모든 설정이 영구적으로 삭제됩니다.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      삭제
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
