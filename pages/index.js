// pages/index.js
import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import styles from '../styles/Home.module.css'

// Signed URL helper
async function getSignedUrl(path, expiresIn = 600) {
  const { data, error } = await supabase.storage.from('entries').createSignedUrl(path, expiresIn)
  if (error) { console.error('signed URL error:', error); return null }
  return data?.signedUrl || null
}

// Quick file-type guess
function guessType(path) {
  const p = path?.toLowerCase?.() || ''
  if (/\.(png|jpg|jpeg|gif|webp|bmp|avif)$/.test(p)) return 'image'
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(p)) return 'video'
  return 'other'
}

export default function Home() {
  const [user, setUser] = useState(null)

  const [groups, setGroups] = useState([])
  const [activeGroupId, setActiveGroupId] = useState('')

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupUnlock, setNewGroupUnlock] = useState('')
  const [joinGroupId, setJoinGroupId] = useState('')

  const [newEntry, setNewEntry] = useState('')
  const [entries, setEntries] = useState([])

  const [signed, setSigned] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // auth
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  // groups
  useEffect(() => { if (user) loadGroups() }, [user])

  // entries
  useEffect(() => { if (user && activeGroupId) loadEntries(activeGroupId) }, [user, activeGroupId])

  async function loadGroups() {
    const u = (await supabase.auth.getUser()).data.user
    const { data: memberships, error: memErr } = await supabase
      .from('group_members').select('group_id').eq('user_id', u.id)
    if (memErr) { console.error(memErr); return }
    const ids = (memberships || []).map(m => m.group_id)
    if (!ids.length) { setGroups([]); setActiveGroupId(''); return }
    const { data, error } = await supabase
      .from('groups').select('id, name, unlock_at').in('id', ids).order('created_at', { ascending: false })
    if (error) { console.error(error); return }
    setGroups(data || [])
    if (data?.length && !activeGroupId) setActiveGroupId(data[0].id)
  }

  async function loadEntries(groupId) {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('id, entry_text, media_url, created_at, user_id')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); return }
    const rows = data || []
    setEntries(rows)
    const out = {}
    for (const e of rows) {
      if (e.media_url) out[e.media_url] = await getSignedUrl(e.media_url)
    }
    setSigned(out)
  }

  async function createGroup() {
    if (!newGroupName || !newGroupUnlock) { setMsg('Enter group name & unlock time'); return }
    setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: group, error } = await supabase
        .from('groups')
        .insert([{ name: newGroupName, unlock_at: newGroupUnlock, created_by: user.id }])
        .select().single()
      if (error) throw error
      const { error: memErr } = await supabase.from('group_members')
        .insert([{ group_id: group.id, user_id: user.id }])
      if (memErr) throw memErr
      setNewGroupName(''); setNewGroupUnlock('')
      await loadGroups()
      setActiveGroupId(group.id)
      setMsg('Group created ✔')
    } catch (e) { console.error(e); setMsg(e.message) }
    finally { setBusy(false) }
  }

  async function joinGroup() {
    if (!joinGroupId) { setMsg('Paste a Group ID (UUID) to join'); return }
    setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('group_members')
        .insert([{ group_id: joinGroupId, user_id: user.id }])
      if (error && !/duplicate key/i.test(error.message)) throw error
      setJoinGroupId('')
      await loadGroups()
      setActiveGroupId(joinGroupId)
      setMsg('Joined group ✔')
    } catch (e) { console.error(e); setMsg(e.message) }
    finally { setBusy(false) }
  }

  async function addEntry() {
    if (!newEntry || !activeGroupId) return
    setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('journal_entries')
        .insert([{ group_id: activeGroupId, user_id: user.id, entry_text: newEntry }])
      if (error) throw new Error('DB insert failed: ' + error.message)
      setNewEntry('')
      await loadEntries(activeGroupId)
      setMsg('Entry saved ✔')
    } catch (e) { console.error(e); setMsg(e.message) }
    finally { setBusy(false) }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0]
    if (!file || !activeGroupId) return
    setBusy(true); setMsg('')
    try {
      // IMPORTANT: use group UUID for the folder (matches RLS uuid(split_part(...)))
      const path = `${activeGroupId}/${crypto.randomUUID()}-${file.name}`

      const { error: upErr } = await supabase.storage.from('entries').upload(path, file, { upsert: false })
      if (upErr) throw new Error('Upload failed: ' + upErr.message)

      const { data: { user } } = await supabase.auth.getUser()
      const { error: dbErr } = await supabase.from('journal_entries')
        .insert([{ group_id: activeGroupId, user_id: user.id, entry_text: null, media_url: path }])
      if (dbErr) throw new Error('DB insert failed: ' + dbErr.message)

      await loadEntries(activeGroupId) // refresh entries + signed URLs
      setMsg('File uploaded ✔')
      e.target.value = ''
    } catch (e2) { console.error(e2); setMsg(e2.message) }
    finally { setBusy(false) }
  }

  async function signOut() { await supabase.auth.signOut(); setUser(null) }

  if (!user) {
    return (
      <main className={styles.container}>
        <h1 className={styles.title}>Time-Capsule</h1>
        <div className={styles.card}>
          <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} />
        </div>
      </main>
    )
  }

  const activeGroup = groups.find(g => g.id === activeGroupId)

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Welcome, <span className={styles.accent}>{user.email}</span>
        </h1>
        <button className={styles.btn} onClick={signOut}>Sign Out</button>
      </header>

      {msg && <div className={styles.note}>{msg}</div>}
      {busy && <div className={styles.loading}>Working…</div>}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Create a Group</h2>
          <div className={styles.row}>
            <label>Group name</label>
            <input className={styles.input} placeholder="e.g., Megan’s Birthday Capsule"
              value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          </div>
          <div className={styles.row}>
            <label>Unlock time</label>
            <input className={styles.input} type="datetime-local"
              value={newGroupUnlock} onChange={(e) => setNewGroupUnlock(e.target.value)} />
          </div>
          <button className={styles.btnPrimary} onClick={createGroup} disabled={busy}>Create</button>
        </section>

        <section className={styles.card}>
          <h2>Join a Group</h2>
          <div className={styles.row}>
            <label>Group ID (UUID)</label>
            <input className={styles.input} placeholder="Paste group ID"
              value={joinGroupId} onChange={(e) => setJoinGroupId(e.target.value)} />
          </div>
          <button className={styles.btn} onClick={joinGroup} disabled={busy}>Join</button>
        </section>
      </div>

      <section className={styles.card}>
        <h2>Your Groups</h2>
        <select className={styles.select} value={activeGroupId} onChange={(e) => setActiveGroupId(e.target.value)}>
          <option value="">Select a group…</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>
              {g.name} — unlocks {new Date(g.unlock_at).toLocaleString()}
            </option>
          ))}
        </select>
        {activeGroup && (
          <p className={styles.helper}>
            Active: <b>{activeGroup.name}</b> • Unlocks {new Date(activeGroup.unlock_at).toLocaleString()}
          </p>
        )}
      </section>

      {activeGroupId && (
        <>
          <section className={styles.card}>
            <h2>New Entry</h2>
            <textarea className={styles.textarea} rows={5}
              placeholder="Write a note to your group…" value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)} />
            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={addEntry} disabled={busy || !newEntry.trim()}>
                Submit Text
              </button>
              <label className={styles.fileLabel}>
                <input type="file" onChange={uploadFile} className={styles.fileInput}/>
                Upload File
              </label>
            </div>
          </section>

          {/* Text Entries */}
          <section className={styles.card}>
            <h2>Entries</h2>
            <p className={styles.helper}>
              If nothing shows, either it’s empty <b>or not unlocked yet</b> — that’s by design.
            </p>
            <ul className={styles.list}>
              {entries.filter(e => e.entry_text).map(e => (
                <li key={e.id} className={styles.listItem}>
                  <div className={styles.itemMeta}>{new Date(e.created_at).toLocaleString()}</div>
                  <div className={styles.itemText}>{e.entry_text}</div>
                </li>
              ))}
              {!entries.some(e => e.entry_text) && <li className={styles.empty}>No text entries yet.</li>}
            </ul>
          </section>

          {/* Media Gallery */}
          <section className={styles.card}>
            <h2>Media</h2>
            <p className={styles.helper}>Pictures/videos are also hidden until unlock time.</p>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {entries.filter(e => e.media_url).map(e => {
                const sUrl = e.media_url ? signed[e.media_url] : null
                const kind = e.media_url ? guessType(e.media_url) : null
                return (
                  <div key={e.id} style={{ textAlign: 'center' }}>
                    <div className={styles.itemMeta}>{new Date(e.created_at).toLocaleString()}</div>
                    {sUrl && kind === 'image' && (
                      <img src={sUrl} alt="uploaded"
                           style={{ marginTop: 8, width: '100%', borderRadius: 12, border: '1px solid var(--border)' }}/>
                    )}
                    {sUrl && kind === 'video' && (
                      <video src={sUrl} controls
                             style={{ marginTop: 8, width: '100%', borderRadius: 12, border: '1px solid var(--border)' }}/>
                    )}
                    {e.media_url && !sUrl && (
                      <div className={styles.itemMedia}>(Locked or unavailable) {e.media_url}</div>
                    )}
                  </div>
                )
              })}
              {!entries.some(e => e.media_url) && <p className={styles.empty}>No media uploaded yet.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
