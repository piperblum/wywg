import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

export default function Home() {
  const [user, setUser] = useState(null)
  const [newEntry, setNewEntry] = useState('')

  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
    }
    fetchSession()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // Add a new journal entry
  const addEntry = async () => {
    if (!newEntry) return

    const { error } = await supabase
      .from('journal_entries')
      .insert([{ user_id: user.id, entry_text: newEntry }])
      .select() // optional, no need to use returned data

    if (error) console.error('Error adding entry:', error)
    setNewEntry('')  // Clear the textarea
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  if (!user) {
    return (
      <div style={{ padding: 20 }}>
        <h1>Journal App</h1>
        <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} />
      </div>
    )
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Welcome, {user.email}</h1>
      <button onClick={signOut}>Sign Out</button>

      <h2>New Entry</h2>
      <textarea
        value={newEntry}
        onChange={(e) => setNewEntry(e.target.value)}
        rows={4}
        cols={50}
      />
      <br />
      <button onClick={addEntry}>Submit Entry</button>

      <p>Your entries are private and cannot be viewed once submitted.</p>
    </div>
  )
}
