## When you need it

A person deletes their own account in settings. The server command is for when they wrote to the privacy address or a court requires deletion: then an operator acts, and the journal names the operator rather than the person.

Deletion cannot be undone. Always run the preview first.

## Preview first

```sh
pnpm account:delete --user person@example.com --dry-run
```

`--dry-run` prints what the command itself will read: the account and its state, shared organisations whose membership goes, personal rooms that will be deleted, the subscription that will not renew, and any blockers. Nothing is written.

Check three things:

1. It is the right account: the address and id match the request.
2. Each shared organisation will still have an administrator; otherwise the command will refuse.
3. The person understands that personal rooms disappear while the shared organisations keep their rooms.

## Delete

```sh
pnpm account:delete --user person@example.com --reason "data subject request" --as ops@example.com
```

Without `--now` the account stops working at once and is anonymised after 14 days. Nobody can sign in to it during those two weeks.

```sh
pnpm account:delete --user person@example.com --reason "court order" --now --as ops@example.com
```

`--now` anonymises immediately and irreversibly, skipping the cancellation window. Use it only when waiting is not possible, for example under a court order.

What happens: personal rooms and their files are deleted, membership in shared organisations is removed, the personal organisation's subscription stops renewing. With `--now` this happens at once; without it, at anonymisation after 14 days. Rooms and history of shared organisations stay with those organisations. The journal gets `account.delete_operator` with the reason and the operator.

## The last administrator

If the person is the last administrator of a shared organisation that still has other members, the command refuses with `LAST_ADMIN`. Somebody else must become an administrator first: otherwise the organisation would be left unmanaged.

The preview lists such organisations and the number of remaining members. That is the list to agree with the customer.

## Check

- `--dry-run` lists organisations, personal rooms, the subscription and any blockers and ends by stating that nothing changed.
- After a deletion without `--now` the person cannot sign in, and the journal has a row with your reason.
- After `--now` personal rooms no longer open, files are erased, and the account has been anonymised.
- Shared organisations are intact: their rooms open for the remaining members.
- A repeated `--now` on a deleted account says there is nothing to delete and writes no second row.

## If something goes wrong

| Message | Cause | What to do |
|---|---|---|
| `no account matches` | the address or id is not in this installation | check the address; an account of the other installation is not here |
| `LAST_ADMIN` | the person is the last administrator of a shared organisation | appoint another administrator and repeat |
| `the account is already deleted` | the account is already deleted | with `--now` a repeat is safe; without it there is nothing to delete |
| `the account was not erased` | the deletion was cancelled at the same moment | check the account state and repeat if it is active again |
| The command cannot delete files | the file store is unreachable | fix access to the store; the command will not leave an account whose files cannot be erased |
| `only an instance operator may delete another account` | the author has no role | name an operator in `--as` |
| `--as ... is required` | the author is missing | add `--as` or `REMO_OPERATOR` |

## Where next

[Limits of the role](/guide/operator/limits) — what an operator does not do and where such requests go.
