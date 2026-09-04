package com.karos.mathclash.engine

/** The four operators a Math Clash line can be built from. */
enum class Op(val symbol: String, val isMultiplicative: Boolean) {
    ADD("+", false),
    SUB("−", false),
    MUL("×", true),
    DIV("÷", true);

    companion object {
        fun fromSymbolOrNull(symbol: String): Op? = entries.firstOrNull { it.symbol == symbol }
    }
}
