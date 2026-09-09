import { authenticated, entity, text, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated(['create', 'read', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
@authenticated('update', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
  include: ['title', 'body'],
})
export class Note {
  @uuid() id!: string
  @text({ min: 1, max: 128 }) user_id!: string
  @text({ min: 1, max: 200 }) title!: string
  @text({ max: 4000 }) body!: string
}
