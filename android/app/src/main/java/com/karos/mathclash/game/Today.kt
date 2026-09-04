package com.karos.mathclash.game

import java.util.Calendar
import java.util.TimeZone

/**
 * Today's date in the device's own timezone.
 *
 * Deliberately built on [Calendar] rather than `java.time`, which only exists
 * from Android 8.0 unless the build pulls in library desugaring. The app needs
 * three things from a date — a seed, a weekday, and a day number to compare
 * streaks with — and none of them are worth a dependency.
 */
class CalendarDay(
    val year: Int,
    val month: Int,
    val dayOfMonth: Int,
    /** 1 = Monday .. 7 = Sunday, the way the rest of the app counts. */
    val isoDayOfWeek: Int,
    /** Days since 1970-01-01, so yesterday is simply today minus one. */
    val epochDay: Long,
) {
    companion object {
        fun today(
            millis: Long = System.currentTimeMillis(),
            zone: TimeZone = TimeZone.getDefault(),
        ): CalendarDay {
            val calendar = Calendar.getInstance(zone)
            calendar.timeInMillis = millis
            val year = calendar.get(Calendar.YEAR)
            val month = calendar.get(Calendar.MONTH) + 1
            val dayOfMonth = calendar.get(Calendar.DAY_OF_MONTH)
            // Calendar starts the week on Sunday (1); shift it to Monday (1).
            val iso = ((calendar.get(Calendar.DAY_OF_WEEK) + 5) % 7) + 1
            return CalendarDay(year, month, dayOfMonth, iso, epochDayOf(year, month, dayOfMonth))
        }

        /**
         * Days from 1970-01-01 to the given civil date, matching
         * `LocalDate.toEpochDay()`. Howard Hinnant's `days_from_civil`, which
         * shifts the year to start in March so leap days land at the end.
         */
        fun epochDayOf(year: Int, month: Int, dayOfMonth: Int): Long {
            val shifted = year.toLong() - if (month <= 2) 1L else 0L
            val era = (if (shifted >= 0) shifted else shifted - 399) / 400
            val yearOfEra = shifted - era * 400
            val dayOfYear = (153 * (month + (if (month > 2) -3 else 9)) + 2) / 5 + dayOfMonth - 1
            val dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
            return era * 146097 + dayOfEra - 719468
        }
    }
}
