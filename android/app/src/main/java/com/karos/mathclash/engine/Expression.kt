package com.karos.mathclash.engine

/** How a line is read. This is a player setting, not a per-puzzle property. */
enum class Precedence { STANDARD, LEFT_TO_RIGHT }

/**
 * Evaluates one line of the board: `v0 op0 v1 op1 v2 ...`.
 *
 * [Precedence.STANDARD] applies `x` and `/` before `+` and `-`;
 * [Precedence.LEFT_TO_RIGHT] simply reads the line from left to right.
 *
 * Arithmetic is exact: the running value is kept as a fraction, so `12 / 8 x 2`
 * is accepted as a legal way to reach `3`. Nothing is allocated on the way —
 * the solver walks millions of lines per board and the garbage would show.
 */
object Expression {

    /**
     * Whole-number value of the line, or null when the line divides by zero or
     * lands on a fraction (a fraction can never equal an integer target).
     */
    fun evaluateInt(values: IntArray, ops: List<Op>, precedence: Precedence): Int? {
        require(values.size == ops.size + 1) { "each gap between values needs one operator" }
        return if (precedence == Precedence.LEFT_TO_RIGHT) {
            leftToRight(values, ops)
        } else {
            standard(values, ops)
        }
    }

    /**
     * Like [evaluateInt] but also rejects a fractional step in the middle. Used
     * when building puzzles, so the intended solution stays mental arithmetic
     * instead of fraction juggling.
     */
    fun evaluateStrict(values: IntArray, ops: List<Op>, precedence: Precedence): Int? {
        require(values.size == ops.size + 1) { "each gap between values needs one operator" }
        if (precedence == Precedence.LEFT_TO_RIGHT) {
            var acc = values[0].toLong()
            for (i in ops.indices) {
                val next = values[i + 1].toLong()
                acc = when (ops[i]) {
                    Op.ADD -> acc + next
                    Op.SUB -> acc - next
                    Op.MUL -> acc * next
                    Op.DIV -> if (next == 0L || acc % next != 0L) return null else acc / next
                }
            }
            return acc.toIntExactOrNull()
        }
        var total = 0L
        var term = values[0].toLong()
        var positive = true
        for (i in ops.indices) {
            val next = values[i + 1].toLong()
            when (ops[i]) {
                Op.MUL -> term *= next
                Op.DIV -> {
                    if (next == 0L || term % next != 0L) return null
                    term /= next
                }
                Op.ADD, Op.SUB -> {
                    total = if (positive) total + term else total - term
                    term = next
                    positive = ops[i] == Op.ADD
                }
            }
        }
        total = if (positive) total + term else total - term
        return total.toIntExactOrNull()
    }

    /** Renders the line the way it is printed on the board, e.g. `7 x 3 - 4`. */
    fun format(values: List<Int?>, ops: List<Op>, blank: String = "?"): String {
        val text = StringBuilder()
        for (i in values.indices) {
            if (i > 0) text.append(' ').append(ops[i - 1].symbol).append(' ')
            text.append(values[i]?.toString() ?: blank)
        }
        return text.toString()
    }

    private fun leftToRight(values: IntArray, ops: List<Op>): Int? {
        var num = values[0].toLong()
        var den = 1L
        for (i in ops.indices) {
            val v = values[i + 1].toLong()
            when (ops[i]) {
                Op.ADD -> num += v * den
                Op.SUB -> num -= v * den
                Op.MUL -> num *= v
                Op.DIV -> {
                    if (v == 0L) return null
                    den *= v
                }
            }
            if (den < 0L) {
                num = -num
                den = -den
            }
            val g = gcd(abs(num), den)
            if (g > 1L) {
                num /= g
                den /= g
            }
        }
        return if (den == 1L) num.toIntExactOrNull() else null
    }

    private fun standard(values: IntArray, ops: List<Op>): Int? {
        // total +/- term, both kept as exact fractions.
        var totalNum = 0L
        var totalDen = 1L
        var termNum = values[0].toLong()
        var termDen = 1L
        var positive = true
        for (i in ops.indices) {
            val v = values[i + 1].toLong()
            when (ops[i]) {
                Op.MUL -> termNum *= v
                Op.DIV -> {
                    if (v == 0L) return null
                    termDen *= v
                }
                Op.ADD, Op.SUB -> {
                    val signedNum = if (positive) termNum else -termNum
                    totalNum = totalNum * termDen + signedNum * totalDen
                    totalDen *= termDen
                    if (totalDen < 0L) {
                        totalNum = -totalNum
                        totalDen = -totalDen
                    }
                    val g = gcd(abs(totalNum), totalDen)
                    if (g > 1L) {
                        totalNum /= g
                        totalDen /= g
                    }
                    termNum = v
                    termDen = 1L
                    positive = ops[i] == Op.ADD
                }
            }
            if (termDen < 0L) {
                termNum = -termNum
                termDen = -termDen
            }
            val g = gcd(abs(termNum), termDen)
            if (g > 1L) {
                termNum /= g
                termDen /= g
            }
        }
        val signedNum = if (positive) termNum else -termNum
        totalNum = totalNum * termDen + signedNum * totalDen
        totalDen *= termDen
        if (totalDen < 0L) {
            totalNum = -totalNum
            totalDen = -totalDen
        }
        val g = gcd(abs(totalNum), totalDen)
        if (g > 1L) {
            totalNum /= g
            totalDen /= g
        }
        return if (totalDen == 1L) totalNum.toIntExactOrNull() else null
    }

    private fun abs(value: Long): Long = if (value < 0L) -value else value

    private tailrec fun gcd(a: Long, b: Long): Long = if (b == 0L) (if (a == 0L) 1L else a) else gcd(b, a % b)

    private fun Long.toIntExactOrNull(): Int? =
        if (this >= Int.MIN_VALUE && this <= Int.MAX_VALUE) toInt() else null
}
