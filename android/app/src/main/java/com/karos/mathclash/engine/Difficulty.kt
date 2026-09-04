package com.karos.mathclash.engine

/**
 * The ladder. Each step adds either a bigger board, a harder operator, or fewer
 * free cells to start from — never all three at once.
 */
enum class Difficulty(
    val id: String,
    val size: Int,
    /** Seconds a confident player needs; the yardstick for scoring, not a limit. */
    val parSeconds: Int,
    val scoreWeight: Double,
    val hints: Int,
) {
    WARMUP("warmup", size = 2, parSeconds = 40, scoreWeight = 0.5, hints = 3),
    EASY("easy", size = 3, parSeconds = 150, scoreWeight = 1.0, hints = 3),
    MEDIUM("medium", size = 3, parSeconds = 210, scoreWeight = 1.4, hints = 3),
    HARD("hard", size = 3, parSeconds = 280, scoreWeight = 1.9, hints = 2),
    EXPERT("expert", size = 4, parSeconds = 480, scoreWeight = 2.6, hints = 2),
    INSANE("insane", size = 4, parSeconds = 720, scoreWeight = 3.4, hints = 1);

    val next: Difficulty? get() = entries.getOrNull(ordinal + 1)

    fun config(precedence: Precedence): PuzzleConfig = when (this) {
        WARMUP -> PuzzleConfig(
            difficulty = this,
            bank = (1..4).toList(),
            ops = listOf(Op.ADD, Op.SUB),
            minTarget = 1,
            maxTarget = 12,
            extraGivens = 0,
            maxGivens = 1,
            precedence = precedence,
        )
        EASY -> PuzzleConfig(
            difficulty = this,
            bank = (1..9).toList(),
            ops = listOf(Op.ADD, Op.SUB),
            minTarget = 1,
            maxTarget = 24,
            extraGivens = 2,
            maxGivens = 4,
            precedence = precedence,
        )
        MEDIUM -> PuzzleConfig(
            difficulty = this,
            bank = (1..9).toList(),
            ops = listOf(Op.ADD, Op.SUB, Op.MUL),
            minTarget = 1,
            maxTarget = 120,
            extraGivens = 1,
            maxGivens = 3,
            precedence = precedence,
        )
        HARD -> PuzzleConfig(
            difficulty = this,
            bank = (1..9).toList(),
            ops = listOf(Op.ADD, Op.SUB, Op.MUL, Op.DIV),
            minTarget = 1,
            maxTarget = 120,
            extraGivens = 0,
            maxGivens = 3,
            precedence = precedence,
        )
        EXPERT -> PuzzleConfig(
            difficulty = this,
            bank = (1..16).toList(),
            ops = listOf(Op.ADD, Op.SUB, Op.MUL),
            minTarget = 1,
            maxTarget = 220,
            extraGivens = 1,
            maxGivens = 5,
            precedence = precedence,
        )
        INSANE -> PuzzleConfig(
            difficulty = this,
            bank = (1..16).toList(),
            ops = listOf(Op.ADD, Op.SUB, Op.MUL, Op.DIV),
            minTarget = 1,
            maxTarget = 220,
            extraGivens = 0,
            maxGivens = 4,
            precedence = precedence,
        )
    }

    companion object {
        fun fromId(id: String?): Difficulty = entries.firstOrNull { it.id == id } ?: EASY
    }
}

class PuzzleConfig(
    val difficulty: Difficulty,
    val bank: List<Int>,
    val ops: List<Op>,
    val minTarget: Int,
    val maxTarget: Int,
    /** Cells revealed on top of the minimum needed to pin the solution down. */
    val extraGivens: Int,
    /** Above this many revealed cells the board is thrown away and rebuilt. */
    val maxGivens: Int,
    val precedence: Precedence,
) {
    val size: Int get() = difficulty.size
}
