'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  PageHeader, Card, CardBody, Badge, Table, THead, TBody, Tr, Th, Td, TableEmpty,
  Button, Input, Kpi, KpiGrid,
} from '../../_ui';

function formatNaira(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const limit = 25;

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    const res = await fetch('/api/users?' + params.toString());
    const json = await res.json();
    setUsers(json.users || []);
    setTotal(json.total || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => { setPage(1); load(); }, [search]);

  const totalPages = Math.ceil(total / limit);

  const exportCSV = async () => {
    setExporting(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('csv', '1');
    const res = await fetch('/api/users?' + params.toString());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Browse every registered customer, jump into individual profiles."
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Download size={14} />}
            onClick={exportCSV}
            loading={exporting}
          >
            {exporting ? 'Exporting' : 'Export CSV'}
          </Button>
        }
      />

      <KpiGrid style={{ marginBottom: 'var(--space-6)' }}>
        <Kpi label="Total users" value={total.toLocaleString()} hint="All-time registrations" />
      </KpiGrid>

      <Card>
        <CardBody tight style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--fg-tertiary)',
                pointerEvents: 'none',
              }}
            />
            <Input
              placeholder="Search name, username, or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
          </div>
        </CardBody>
      </Card>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Card>
          <CardBody flush>
            <Table flush>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Username</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th align="right">Balance</Th>
                  <Th align="right">Trades</Th>
                  <Th>Status</Th>
                  <Th>Joined</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {loading ? (
                  <TableEmpty colSpan={9}>Loading…</TableEmpty>
                ) : users.length === 0 ? (
                  <TableEmpty colSpan={9}>No users found</TableEmpty>
                ) : users.map((u: any) => (
                  <Tr key={u.id}>
                    <Td emphasis="primary">{u.full_name || '—'}</Td>
                    <Td emphasis="secondary">@{u.username || '—'}</Td>
                    <Td emphasis="secondary">{u.email || '—'}</Td>
                    <Td emphasis="secondary">{u.phone || '—'}</Td>
                    <Td align="right" mono emphasis="primary">{formatNaira(u.balance)}</Td>
                    <Td align="right" mono>{u.trades || 0}</Td>
                    <Td>
                      {u.is_frozen ? (
                        <Badge tone="danger">Frozen</Badge>
                      ) : u.is_active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Inactive</Badge>
                      )}
                    </Td>
                    <Td emphasis="secondary">{new Date(u.created_at).toLocaleDateString()}</Td>
                    <Td align="right">
                      <Link href={`/users/${u.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ChevronLeft size={14} />}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ChevronRight size={14} />}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
