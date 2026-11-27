import { BrandMark } from "@remo/ui";
import { useId, type ReactNode } from "react";
import { Shake } from "./Shake";

/** The header stays usable while the closed room shows its next action. */
export function RoomGateCard({ title, description, illustration, attempt = 0, children }: {
  title: string;
  description: string;
  illustration?: ReactNode;
  attempt?: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="access-gate guest-password" aria-labelledby={id}>
      <Shake token={attempt} className="guest-gate-card">
        {illustration ?? <BrandMark size={84} />}
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
        {children}
      </Shake>
    </section>
  );
}
