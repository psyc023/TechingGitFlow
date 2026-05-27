using Microsoft.EntityFrameworkCore;
using PasswordManager.Api.Models;

namespace PasswordManager.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<PasswordItem> Passwords => Set<PasswordItem>();
    public DbSet<SectionItem> Sections => Set<SectionItem>();
    public DbSet<LinkItem> Links => Set<LinkItem>();
    public DbSet<PendingTaskItem> PendingTasks => Set<PendingTaskItem>();
}