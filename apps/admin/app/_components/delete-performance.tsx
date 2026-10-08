"use client";
import { deletePerformance } from "../actions";
export function DeletePerformance({id}: {id: string}) {
  return <form action={deletePerformance} onSubmit={event => {
    if (!window.confirm("Delete this performance? Linked ticket sales must be unlinked first.")) event.preventDefault();
  }}>
    <input type="hidden" name="id" value={id} />
    <button className="button-danger" type="submit">Delete performance</button>
  </form>;
}
