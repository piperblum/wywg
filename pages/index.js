// pages/index.js
import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import styles from '../styles/Home.module.css'

export default function Home() {
  const [user, setUser] = useState(null)

  const [groups, setGroups] = useState([])
  const [activeGroupId, setActiveGroupId] = useState('')

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupUnlock, setNewGroupUnlock] = useState('') // yyyy-mm-ddThh:mm
  const [joinGroupId, setJoinGroupId] = useState('')

  const [newEntry, setNewEntry] = useState('')
  const [entries, setEntries] = useState([])

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // --- auth bootstrap
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
    }
    init()
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // load groups for this user
  useEffect(() => {
    if (!user) return
    loadGroups()
  }, [user])

  // load entries when switching group
  useEffect(() => {
    if (!user || !activeGroupId) return
    loadEntries(activeGroupId)
  }, [user, activeGroupId])

  async function loadGroups() {
    const u = (await supabase.auth.getUser()).data.user
    const { data: memberships, error: memErr } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', u.id)
    if (memErr) { console.error(memErr); return }

    const ids = (memberships || []).map(m => m.group_id)
    if (!ids.length) { setGroups([]); setActiveGroupId(''); return }

    const { data, error } = await supabase
      .from('groups')
      .select('id, name, unlock_at')
      .in('id', ids)
      .order('created_at', { ascending: false })
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
    // Before unlock, RLS returns 0 rows (expected)
    if (error) { console.error(error); return }
    setEntries(data || [])
  }

  async function createGroup() {
    if (!newGroupName || !newGroupUnlock) { setMsg('Enter group name & unlock time'); return }
    setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: group, error } = await supabase
        .from('groups')
        .insert([{ name: newGroupName, unlock_at: newGroupUnlock, created_by: user.id }])
        .select()
        .single()
      if (error) throw error
      await supabase.from('group_members').insert([{ group_id: group.id, user_id: user.id }])
      setNewGroupName(''); setNewGroupUnlock('')
      await loadGroups()
      setActiveGroupId(group.id)
      setMsg('Group created ✔')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function joinGroup() {
    if (!joinGroupId) { setMsg('Paste a Group ID (UUID) to join'); return }
    setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('group_members')
        .insert([{ group_id: joinGroupId, user_id: user.id }])
      if (error && !/duplicate key/i.test(error.message)) throw error
      setJoinGroupId('')
      await loadGroups()
      setActiveGroupId(joinGroupId)
      setMsg('Joined group ✔')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function addEntry() {
    if (!newEntry || !activeGroupId) return
    setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('journal_entries')
        .insert([{ group_id: activeGroupId, user_id: user.id, entry_text: newEntry }])
      if (error) throw new Error('Error adding entry: ' + error.message)
      setNewEntry('')
      await loadEntries(activeGroupId)
      setMsg('Entry saved ✔')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0]
    if (!file || !activeGroupId) return
    setBusy(true); setMsg('')
    try {
      const path = `${activeGroupId}/${crypto.randomUUID()}-${file.name}`
      const { error: upErr } = await supabase.storage
        .from('entries')
        .upload(path, file, { upsert: false })
      if (upErr) throw new Error('Upload failed: ' + upErr.message)

      const { data: { user } } = await supabase.auth.getUser()
      await supabase
        .from('journal_entries')
        .insert([{ group_id: activeGroupId, user_id: user.id, media_url: path }])

      await loadEntries(activeGroupId)
      setMsg('File uploaded ✔')
      e.target.value = ''
    } catch (e2) {
      setMsg(e2.message)
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
  }

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
        <h1 className={styles.title}>Welcome, <span className={styles.accent}>{user.email}</span></h1>
        <button className={styles.btn} onClick={signOut}>Sign Out</button>
      </header>

      {msg && <div className={styles.note}>{msg}</div>}
      {busy && <div className={styles.loading}>Working…</div>}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Create a Group</h2>
          <div className={styles.row}>
            <label>Group name</label>
            <input
              className={styles.input}
              placeholder="e.g., Megan’s Birthday Capsule"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
          </div>
          <div className={styles.row}>
            <label>Unlock time</label>
            <input
              className={styles.input}
              type="datetime-local"
              value={newGroupUnlock}
              onChange={(e) => setNewGroupUnlock(e.target.value)}
            />
          </div>
          <button className={styles.btnPrimary} onClick={createGroup} disabled={busy}>Create</button>
        </section>

        <section className={styles.card}>
          <h2>Join a Group</h2>
          <div className={styles.row}>
            <label>Group ID (UUID)</label>
            <input
              className={styles.input}
              placeholder="Paste group ID"
              value={joinGroupId}
              onChange={(e) => setJoinGroupId(e.target.value)}
            />
          </div>
          <button className={styles.btn} onClick={joinGroup} disabled={busy}>Join</button>
        </section>
      </div>

      <section className={styles.card}>
        <h2>Your Groups</h2>
        <select
          className={styles.input}
          value={activeGroupId}
          onChange={(e) => setActiveGroupId(e.target.value)}
        >
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
            <textarea
              className={styles.textarea}
              rows={5}
              placeholder="Write a note to your group…"
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
            />
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

          <section className={styles.card}>
            <h2>Entries</h2>
            <p className={styles.helper}>
              If nothing shows, either it’s empty <b>or not unlocked yet</b> — that’s by design.
            </p>
            <ul className={styles.list}>
              {entries.map(e => (
                <li key={e.id} className={styles.listItem}>
                  <div className={styles.itemMeta}>
                    {new Date(e.created_at).toLocaleString()}
                  </div>
                  {e.entry_text && <div className={styles.itemText}>{e.entry_text}</div>}
                  {e.media_url && <div className={styles.itemMedia}>Uploaded: {e.media_url}</div>}
                </li>
              ))}
              {!entries.length && <li className={styles.empty}>No entries to show.</li>}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
