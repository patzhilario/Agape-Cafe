import { getSupabaseClient } from '../../lib/supabaseClient.js'

function unwrap({ data, error }, action) {
  if (error) throw new Error(`${action}: ${error.message}`)
  return data
}

export async function getOperationalReport(branchId, startDate, endDate, page = 0, pageSize = 50) {
  return unwrap(
    await getSupabaseClient().rpc('get_operational_report_with_payments', {
      target_branch_id: branchId || null,
      start_date: startDate,
      end_date: endDate,
      page_offset: page * pageSize,
      page_size: pageSize,
    }),
    'Could not load the operational report',
  )
}

export async function getAllOperationalReport(branchId, startDate, endDate) {
  const pageSize = 250
  const allOrders = []
  for (let page = 0; ; page += 1) {
    const nextOrders = await getOperationalReport(
      branchId,
      startDate,
      endDate,
      page,
      pageSize,
    )
    allOrders.push(...nextOrders)
    if (nextOrders.length < pageSize) return allOrders
    if (allOrders.length >= 10000) {
      const overflow = await getOperationalReport(
        branchId,
        startDate,
        endDate,
        page + 1,
        pageSize,
      )
      if (overflow.length) {
        throw new Error('Export is limited to 10,000 orders. Narrow the date range.')
      }
      return allOrders
    }
  }
}

export async function getFinancialReport(branchId, startDate, endDate) {
  const rows = unwrap(
    await getSupabaseClient().rpc('get_financial_report_with_payments', {
      target_branch_id: branchId || null,
      start_date: startDate,
      end_date: endDate,
    }),
    'Could not load the financial report',
  )
  return rows[0]
}

export async function getBranchExpenses(branchId, startDate, endDate, page = 0, pageSize = 50) {
  let query = getSupabaseClient()
    .from('branch_expenses')
    .select('id, branch_id, occurred_on, category, description, amount, note, created_at, voided_at, void_reason')
    .gte('occurred_on', startDate)
    .lte('occurred_on', endDate)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (branchId) query = query.eq('branch_id', branchId)
  return unwrap(await query, 'Could not load branch expenses')
}

export async function getAllBranchExpenses(branchId, startDate, endDate) {
  const pageSize = 250
  const allExpenses = []
  for (let page = 0; ; page += 1) {
    const nextExpenses = await getBranchExpenses(
      branchId,
      startDate,
      endDate,
      page,
      pageSize,
    )
    allExpenses.push(...nextExpenses)
    if (nextExpenses.length < pageSize) return allExpenses
    if (allExpenses.length >= 10000) {
      const overflow = await getBranchExpenses(
        branchId,
        startDate,
        endDate,
        page + 1,
        pageSize,
      )
      if (overflow.length) {
        throw new Error('Export is limited to 10,000 expenses. Narrow the date range.')
      }
      return allExpenses
    }
  }
}

export async function recordBranchExpense(expense) {
  return unwrap(
    await getSupabaseClient().rpc('record_branch_expense', {
      target_branch_id: expense.branchId,
      target_occurred_on: expense.occurredOn,
      target_category: expense.category,
      target_description: expense.description,
      target_amount: Number(expense.amount),
      target_note: expense.note,
    }),
    'Could not record expense',
  )
}

export async function voidBranchExpense(expenseId, reason) {
  return unwrap(
    await getSupabaseClient().rpc('void_branch_expense', {
      target_expense_id: expenseId,
      target_reason: reason,
    }),
    'Could not void expense',
  )
}

function csvCell(value) {
  let text = String(value ?? '')
  if (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function downloadCsv(filename, headers, rows) {
  const content = [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
