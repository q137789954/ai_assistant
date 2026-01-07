'use client'

import * as React from 'react'
import { LeaderboardDialog, type LeaderboardEntry } from '../LeaderboardDialog'

const mock: LeaderboardEntry[] = Array.from({ length: 20 }).map((_, i) => ({
  rank: i + 1,
  name: `Player_${i + 1}`,
  wins: 500 - (i + 1) * 12,
}))

export default function LeaderboardBtn() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <div className='cursor-pointer text-2xl' onClick={() => setOpen(true)}>🏆</div>

      <LeaderboardDialog
        open={open}
        onOpenChange={setOpen}
        title="Global Top 100"
        entries={mock}
        myRank={{
          rankText: '100+',
          name: 'You (Player)',
          winsText: '12 Wins',
          avatarUrl: 'https://placehold.co/100x100/333/CCFF00?text=ME',
          emoji: '🔥',
        }}
      />
    </>
  )
}
