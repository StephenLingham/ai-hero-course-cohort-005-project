# A student's Enrollment is not tied to the Purchase that granted it

A student has one Enrollment per course, whether it came from an Individual Purchase or a Claimed Seat, and the Enrollment doesn't record which. A Refund Request, by contrast, belongs to one specific Purchase. So approving a refund on an Individual Purchase must check whether the student also holds a Claimed Seat for that course, and leave their Enrollment alone if they do.

This keeps Enrollment focused on whether a student has access, rather than recording each Purchase that grants it. The trade-off is that refund approval must check other sources of access before removing the Enrollment.

## Consequences

The code used to attach a Refund Request to the buyer's newest Purchase of the course. A student who bought for themselves and then bought a Team Licence would have refunded the wrong one. The buyer now chooses the Purchase: Individual Purchases from the course page, Team Licences from the team page.
