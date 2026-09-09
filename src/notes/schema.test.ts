import { claims, createItemProxy, getEntityMetadata, ComparisonExpression } from '@microsoft/rayfin-core'
import { expect, it } from 'vitest'
import { Note } from '../../rayfin/data/Note'
import { schema } from '../../rayfin/data/schema'

it('registers the local Note entity with bounded fields and explicit owner permissions', () => {
  expect(schema).toEqual([Note])
  const metadata = getEntityMetadata(Note)
  expect(metadata.fields.user_id).toMatchObject({ min: 1, max: 128 })
  expect(metadata.fields.title).toMatchObject({ min: 1, max: 200 })
  expect(metadata.fields.body).toMatchObject({ max: 4000 })
  expect(metadata.fields.id.format).toBe('uuid')
  const roles = metadata.roles!
  expect(roles).toHaveLength(2)
  expect(roles.flatMap((role) => role.actions).sort()).toEqual(['create', 'delete', 'read', 'update'])
  for (const role of roles) {
    expect(role.role).toBe('authenticated')
    const expression = role.policy!.check(claims, createItemProxy<Note>())
    expect(expression).toBeInstanceOf(ComparisonExpression)
    const comparison = expression as ComparisonExpression
    expect(comparison.operator).toBe('eq')
    expect(comparison.left).toMatchObject({ name: 'sub' })
    expect(comparison.right).toMatchObject({ name: 'user_id' })
  }
  expect(roles.find((role) => role.actions.includes('update'))?.includedFields).toEqual(['title', 'body'])
})
