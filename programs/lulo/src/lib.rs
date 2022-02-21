use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

declare_id!("4kXHnTp8636AyLh18C2jai11fXuDMkGSiuwnn8SVST2e");

mod error;

#[program]
pub mod lulo {

    use super::*;

    /* Initializes program and creates pay mint */
    pub fn initialize(ctx: Context<Initialize>) -> ProgramResult {
        let state = &mut ctx.accounts.state;
        state.admin = *ctx.accounts.signer.key;
        state.pay_mint = ctx.accounts.mint.key();
        state.pay_mint_bump = *ctx.bumps.get("state").unwrap();
        Ok(())
    }

    /* Creates a new Vault */
    pub fn open_vault(ctx: Context<OpenVault>) -> ProgramResult {
        // Init Positions
        let positions = &mut ctx.accounts.positions.load_init()?;
        positions.vault = ctx.accounts.vault.key();

        // Set Vault metadata
        let vault = &mut ctx.accounts.vault;
        vault.admin = *ctx.accounts.signer.key;
        vault.balance = 0;
        vault.positions = ctx.accounts.positions.key();
        vault.active_branches = 0;

        Ok(())
    }

    /* Close a Vault, requires clearing outstanding liabilities */
    pub fn close_vault(ctx: Context<CloseVault>) -> ProgramResult {
        Ok(())
    }

    /* Creates a new Branch */
    pub fn open_branch(ctx: Context<OpenBranch>) -> ProgramResult {
        // Mint bump
        let mint_bump = *ctx.bumps.get("mint").unwrap();

        // Mint Branch NFT
        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.mint_account.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                &[&[
                    &b"mint"[..],
                    &ctx.accounts.branch.key().as_ref(),
                    &[mint_bump],
                ]],
            ),
            1,
        )?;

        // Update Branch metadata
        let branch = &mut ctx.accounts.branch;
        branch.vault = ctx.accounts.vault.key();
        branch.mint = ctx.accounts.mint.key();
        branch.balance = 0;
        branch.active = true;

        // Update Vault metadata
        let vault = &mut ctx.accounts.vault;
        vault.active_branches += 1;
        Ok(())
    }

    /* Closes a branch */
    pub fn close_branch(ctx: Context<CloseBranch>) -> ProgramResult {
        // Mark Branch inactive
        let branch = &mut ctx.accounts.branch;
        branch.active = false;

        // Update Vault metdata
        let vault = &mut ctx.accounts.vault;
        vault.active_branches -= 1;
        Ok(())
    }

    /* Mints against a Vault and pays it to the recipient */
    pub fn pay(ctx: Context<Pay>, amount: u64) -> ProgramResult {
        // Branch must be active
        require!(
            ctx.accounts.branch.active == true,
            error::LuloError::InactiveBranch
        );
        // Pay mint bump
        let mint_bump = *ctx.bumps.get("pay_mint").unwrap();
        // Mint to recipient
        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.pay_mint.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                    authority: ctx.accounts.pay_mint.to_account_info(),
                },
                &[&[&b"pay_mint"[..], &[mint_bump]]],
            ),
            amount,
        )?;
        // Add debt to Branch
        let branch = &mut ctx.accounts.branch;
        branch.balance += amount;

        // Add debt to Vault
        let vault = &mut ctx.accounts.vault;
        vault.balance += amount;

        Ok(())
    }

    /* Swap iUSDC for USDC */
    pub fn swap(ctx: Context<Swap>, amount: u64) -> ProgramResult {
        // Burn iUSDC
        anchor_spl::token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Burn {
                    mint: ctx.accounts.pay_mint.to_account_info(),
                    to: ctx.accounts.settle.to_account_info(),
                    authority: ctx.accounts.signer.to_account_info(),
                },
                &[],
            ),
            amount,
        )?;
        // Controller bump
        let controller_bump = *ctx.bumps.get("controller").unwrap();
        // Transfer USDC to recipient
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.controller.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                    authority: ctx.accounts.controller.to_account_info(),
                },
                &[&[
                    &b"controller"[..],
                    &ctx.accounts.controller_mint.key().as_ref(),
                    &[controller_bump],
                ]],
            ),
            amount,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 150,
        payer = signer,
        seeds = [b"lulo"],
        bump
    )]
    pub state: Box<Account<'info, State>>,
    #[account(
        // TODO: REMOVE IF NEEDED
        init_if_needed,
        payer = signer,
        mint::decimals = 6,
        mint::authority = mint,
        seeds = [b"pay_mint"],
        bump
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = signer,
        token::mint = controller_mint,
        token::authority = controller,
        seeds = [b"controller", controller_mint.key().as_ref()],
        bump
    )]
    pub controller: Box<Account<'info, TokenAccount>>,
    #[account()]
    pub controller_mint: Box<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct OpenVault<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        space = 350,
        payer = signer
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init,
        payer = signer
    )]
    pub positions: AccountLoader<'info, Positions>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct CloseVault {}
#[derive(Accounts)]
pub struct OpenBranch<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        constraint = signer.key() == vault.admin)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init,
        payer = signer,
        seeds = [b"branch", vault.key().as_ref()],
        bump
    )]
    pub branch: Box<Account<'info, Branch>>,
    #[account(
        init,
        payer = signer,
        mint::decimals = 0,
        mint::authority = mint,
        mint::freeze_authority = mint,
        seeds = [b"mint", branch.key().as_ref()],
        bump
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = signer,
        token::mint = mint,
        token::authority = signer
    )]
    pub mint_account: Box<Account<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pay_mint"],
        bump)]
    pub pay_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        constraint = branch.vault == vault.key())]
    pub branch: Box<Account<'info, Branch>>,
    #[account(
        mut,
        constraint = branch_nft.amount == 1,
        constraint = branch_nft.mint == branch.mint,
        constraint = branch_nft.owner == signer.key())]
    pub branch_nft: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = recipient.mint == pay_mint.key())]
    pub recipient: Box<Account<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account()]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pay_mint"],
        bump
    )]
    pub pay_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub controller_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [b"controller", controller_mint.key().as_ref()],
        bump)]
    pub controller: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = settle.mint == pay_mint.key(),
        constraint = settle.owner == signer.key())]
    pub settle: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = recipient.mint == controller_mint.key())]
    pub recipient: Box<Account<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseBranch<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        constraint = signer.key() == vault.admin)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        close = signer,
        seeds = [b"branch", vault.key().as_ref()],
        bump
    )]
    pub branch: Box<Account<'info, Branch>>,
    #[account(
        mut,
        seeds = [b"mint", branch.key().as_ref()],
        bump
    )]
    pub mint: Box<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

// Manages branches and collateral
#[account]
pub struct Vault {
    admin: Pubkey,
    bump: u8,
    balance: u64,
    active_branches: u64,
    positions: Pubkey,
}
// Tracks collateral deposited into a Vault
#[account(zero_copy)]
#[derive(Default)]
pub struct Positions {
    pub vault: Pubkey,
    pub num_positions: u64,
    pub positions: [Pubkey; 5],
}
// Represents SPL deposited and used as collateral. Collateral info is indexed in Collaterals array.
#[zero_copy]
#[derive(Default)]
pub struct CollateralPosition {
    pub amount: u64,
    pub mint: Pubkey,
}
#[account]
#[derive(Default)]
pub struct Branch {
    pub active: bool,
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub balance: u64,
}

// Collateral accepted
#[account(zero_copy)]
#[derive(Default)]
pub struct Collateral {
    pub initialized: bool,
    pub mint: Pubkey,
    pub fee: u64,
    pub equity_value: u64,
}
// State
#[account]
pub struct State {
    admin: Pubkey,
    pay_mint: Pubkey,
    pay_mint_bump: u8,
}
