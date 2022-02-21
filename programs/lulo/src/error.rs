use anchor_lang::prelude::*;

#[error]
pub enum LuloError {
    #[msg("Inactive Branch")]
    InactiveBranch,
}
